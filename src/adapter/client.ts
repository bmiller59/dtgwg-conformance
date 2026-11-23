// SPDX-License-Identifier: Apache-2.0
// Out-of-process adapter client (docs/04-suite-design.md section 4). `RpcAdapter` implements the
// `Adapter` interface over a JSON-RPC 2.0 transport, so the runner can drive an implementation
// under test that lives in another process: stdio (newline-delimited JSON) or HTTP (one POST per call).
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type {
  Adapter, Capabilities, ConnectParams, ConnectResult, InitiateParams, InitiateResult, DeclareGovernanceResult, EmitParams, EmitResult, GovernanceDeclaration, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, RpcResponse, SendParams, SendResult, VerifyReceiptParams, VerifyReceiptResult,
} from "./contract.ts";
import { isObject } from "../util/json.ts";

export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** A transport carries one JSON-RPC request and returns its response. */
export interface RpcTransport {
  call(method: string, params: unknown): Promise<RpcResponse>;
  close(): Promise<void>;
}

/** An error the adapter reported (JSON-RPC `error`). The message is the adapter's own, unchanged. */
export class AdapterRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** A failure of the transport itself (process exit, connection refused, timeout, malformed reply). */
export class TransportError extends Error {}

function checkResponse(res: unknown, id: number): RpcResponse {
  if (!isObject(res) || res.jsonrpc !== "2.0") throw new TransportError("reply is not a JSON-RPC 2.0 response");
  if (res.id !== id) throw new TransportError(`reply id ${JSON.stringify(res.id)} does not match request id ${id}`);
  if (!("result" in res) && !("error" in res)) throw new TransportError("reply has neither result nor error");
  return res as unknown as RpcResponse;
}

/** Spawns `command` through the shell and exchanges one JSON object per line on its stdin and stdout. */
export class StdioTransport implements RpcTransport {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, { resolve: (r: RpcResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private buffer = "";
  private closed = false;
  private exitError: Error | undefined;
  private readonly timeoutMs: number;

  constructor(command: string, options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.onData(chunk));
    this.child.on("error", (err) => this.failAll(new TransportError(`cannot start adapter command: ${err.message}`)));
    this.child.on("exit", (code, signal) => {
      this.exitError = new TransportError(`adapter process exited (${signal ?? `code ${String(code)}`})`);
      this.failAll(this.exitError);
    });
    // A write to a process that has already gone away must not crash the runner.
    this.child.stdin!.on("error", () => undefined);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.failAll(new TransportError(`adapter wrote a line that is not JSON: ${line.slice(0, 80)}`));
        return;
      }
      const id = isObject(parsed) && typeof parsed.id === "number" ? parsed.id : undefined;
      const entry = id === undefined ? undefined : this.pending.get(id);
      if (entry === undefined || id === undefined) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      try {
        entry.resolve(checkResponse(parsed, id));
      } catch (err) {
        entry.reject(err as Error);
      }
    }
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  call(method: string, params: unknown): Promise<RpcResponse> {
    if (this.closed) return Promise.reject(new TransportError("transport is closed"));
    if (this.exitError !== undefined) return Promise.reject(this.exitError);
    const id = this.nextId++;
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TransportError(`${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const line = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) + "\n";
      this.child.stdin!.write(line);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin!.end();
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      const kill = setTimeout(() => this.child.kill("SIGKILL"), 2000);
      this.child.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
    });
  }
}

/** One HTTP POST per call to `url`; the body is the JSON-RPC request, the 200 reply body the JSON-RPC response. */
export class HttpTransport implements RpcTransport {
  private nextId = 1;
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(url: string, options: { timeoutMs?: number } = {}) {
    this.url = url;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  async call(method: string, params: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new TransportError(`${method}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TransportError(`${method}: HTTP ${res.status} reply is not JSON`);
    }
    return checkResponse(parsed, id);
  }

  async close(): Promise<void> {
    /* no connection is kept */
  }
}

/** The adapter contract over any transport. Every method maps to the JSON-RPC method of the same name. */
export class RpcAdapter implements Adapter {
  readonly transport: RpcTransport;

  constructor(transport: RpcTransport) {
    this.transport = transport;
  }

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const res = await this.transport.call(method, params);
    if ("error" in res) throw new AdapterRpcError(res.error.code, res.error.message);
    return res.result as T;
  }

  capabilities(): Promise<Capabilities> {
    return this.rpc("capabilities");
  }
  provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    return this.rpc("provision", { roles });
  }
  async trust(vid: string, didDocument?: unknown): Promise<void> {
    await this.rpc("trust", { vid, ...(didDocument === undefined ? {} : { didDocument }) });
  }
  async setClock(iso: string): Promise<void> {
    await this.rpc("setClock", { iso });
  }
  async advance(ms: number): Promise<void> {
    await this.rpc("advance", { ms });
  }
  send(params: SendParams): Promise<SendResult> {
    return this.rpc("send", params);
  }
  trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    return this.rpc("trigger", { action, args });
  }
  observe(query: ObserveQuery): Promise<ObserveResult> {
    return this.rpc("observe", query);
  }
  async restart(): Promise<void> {
    await this.rpc("restart");
  }
  async reset(): Promise<void> {
    await this.rpc("reset");
  }
  snapshot(): Promise<string> {
    return this.rpc("snapshot");
  }
  diff(snapshotId: string): Promise<{ changed: boolean; detail?: string }> {
    return this.rpc("diff", { snapshotId });
  }
  verifyProof(params: { bytes: string }): Promise<ProofVerifyResult> {
    return this.rpc("verifyProof", params);
  }
  emit(params: EmitParams): Promise<EmitResult> {
    return this.rpc("emit", params);
  }
  declareGovernance(decl: GovernanceDeclaration): Promise<DeclareGovernanceResult> {
    return this.rpc("declareGovernance", decl);
  }
  verifyReceipt(params: VerifyReceiptParams): Promise<VerifyReceiptResult> {
    return this.rpc("verifyReceipt", params);
  }
  initiate(params: InitiateParams): Promise<InitiateResult> {
    return this.rpc("initiate", params);
  }
  connect(params: ConnectParams): Promise<ConnectResult> {
    return this.rpc("connect", params);
  }
  close(): Promise<void> {
    return this.transport.close();
  }
}

/** Build an adapter from a CLI spec: `stdio:<command>` or `http:<url>` (see below for the accepted URL spellings). */
export function rpcAdapterFromSpec(spec: string, options: { timeoutMs?: number } = {}): RpcAdapter {
  if (spec.startsWith("stdio:")) {
    const command = spec.slice(6).trim();
    if (command === "") throw new Error("stdio: needs a command");
    return new RpcAdapter(new StdioTransport(command, options));
  }
  if (spec.startsWith("http:") || spec.startsWith("https:")) {
    // `http:<url>` where the url is complete (`http:http://host:port/rpc`), a plain URL (`http://host:port/rpc`), or `http:host:port/rpc`.
    let url = spec.startsWith("http:http") || spec.startsWith("http:https") ? spec.slice(5) : spec;
    if (!/^https?:\/\//.test(url)) url = `http://${spec.slice(5)}`;
    if (!/^https?:\/\/[^/\s]+/.test(url)) throw new Error("http: needs a URL such as http://127.0.0.1:8080/rpc");
    return new RpcAdapter(new HttpTransport(url, options));
  }
  throw new Error(`not an out-of-process adapter spec: ${spec}`);
}
