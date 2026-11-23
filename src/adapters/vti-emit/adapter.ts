// SPDX-License-Identifier: Apache-2.0
// Producer-class (emit) adapter for VTI (docs/19). It drives VTI's own client-side builders (vta-sdk `VtaClient`) in a small Rust host
// (rust/) with a fixed identity against a capture endpoint that keeps the whole signed document, proof included. Every other method of
// the adapter contract is refused: this adapter measures what VTI emits, nothing it serves.
import { loadTask } from "../../plain/catalog.ts";
import { cited } from "../../adapter/contract.ts";
import type { NotOfferedEntry } from "../../adapter/contract.ts";
import type { Adapter, Capabilities, EmitParams, EssentialGovernance, EmitResult, ObserveQuery, ObserveResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";

/** Essential governance (docs/04 section 19) of the emit surface: nothing to state, and why. */
export const EMIT_ESSENTIAL: EssentialGovernance = { source: "unreadable", reason: "emit surface: the adapter drives VTI's client-side builders only, so the platform serves nothing here and holds no task for a decision; the VTA's E is stated by the in-process VTA adapter" };

export interface EmitType {
  type: string;
  method: string;
  governance: string | null;
}

export interface VtiEmitOptions {
  controlUrl: string;
  version: string;
  /** Evidence per unbuilt type (`emit:<type>` -> reason, cited), from the source survey; see not-built.ts. */
  notOffered?: Record<string, string | NotOfferedEntry>;
}

export const EMIT_NAME = "vti-emit";

async function ctl(url: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
  return res.json();
}

export class VtiEmitAdapter implements Adapter {
  private readonly o: VtiEmitOptions;
  private types: EmitType[] | undefined;
  /** Notes the host reported when a builder fixed a governance value itself, per type (for the evidence record). */
  readonly governance = new Map<string, string>();
  /** The builder's own client error per type (the capture endpoint refuses every request), for the evidence record. */
  readonly builders = new Map<string, { method: string; clientError: string | null; documents: number }>();

  constructor(o: VtiEmitOptions) {
    this.o = o;
  }

  async emitTypes(): Promise<EmitType[]> {
    this.types ??= ((await ctl(this.o.controlUrl, "/ctl/types")) as { types: EmitType[] }).types;
    return this.types;
  }

  /** Runs every builder once, so a type whose builder runs but whose client refuses to send is reported with its own error rather than as emitted. */
  private async probe(): Promise<{ emits: string[]; refused: Record<string, string> }> {
    const emits: string[] = [];
    const refused: Record<string, string> = {};
    for (const t of await this.emitTypes()) {
      try {
        await this.emit({ type: t.type });
        emits.push(t.type);
      } catch {
        const b = this.builders.get(t.type);
        refused[`emit:${t.type}`] = `${b?.method ?? t.method} runs, but VTI's own client refuses to send the document it would build (${(b?.clientError ?? "no error reported").replace(/ The recipient would reject.*$/s, "")})`;
      }
    }
    return { emits, refused };
  }

  async capabilities(): Promise<Capabilities> {
    const { emits, refused } = await this.probe();
    return {
      name: EMIT_NAME,
      implementation: "VTI vta-sdk VtaClient (client-side builders)",
      version: this.o.version,
      tierMax: 1,
      bindings: ["in-process"],
      supportedTypes: [],
      carriers: [],
      cryptosuites: [],
      optional: ["emit", "clockFree"],
      emits,
      // Essential governance (docs/04 section 19): this surface only builds and sends documents; it serves nothing and holds no task for anyone to decide.
      governance: { essential: EMIT_ESSENTIAL },
      // Cited (docs/04 section 8): a refusal is observed from VTI's own client in this process, at start-up.
      notOffered: { ...(this.o.notOffered ?? {}), ...cited(refused, "observed: VTI's own client (vta-sdk VtaClient) refused to send the document its builder made, in the start-up probe of this adapter") },
      pins: { framework: "0.6.0", error: "0.6", binding: "https/0.3" },
    };
  }

  async emit(params: EmitParams): Promise<EmitResult> {
    const r = (await ctl(this.o.controlUrl, "/ctl/emit", { type: params.type, sample: loadTask(params.type)?.validPayload ?? {}, ...(typeof params.args?.recipient === "string" ? { recipient: params.args.recipient } : {}) })) as { error?: string; method?: string; governance?: string | null; clientError?: string | null; documents?: string[] };
    if (r.error !== undefined) throw new Error(r.error);
    const docs = (r.documents ?? []).filter((d) => {
      try {
        return (JSON.parse(d) as { type?: string }).type === params.type;
      } catch {
        return false;
      }
    });
    this.builders.set(params.type, { method: r.method ?? "", clientError: r.clientError ?? null, documents: docs.length });
    if (typeof r.governance === "string") this.governance.set(params.type, r.governance);
    if (docs.length === 0) throw new Error(`${r.method} built no ${params.type} document (client error: ${r.clientError ?? "none"})`);
    return { documents: docs };
  }

  private refused(): never {
    throw new Error("the VTI emit adapter drives VTI's client builders only; it serves nothing");
  }
  /** The host's identity signs what the builders emit; the harness never addresses the implementation, so the role is nominal. */
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    return Object.fromEntries(roles.map((r) => [r, { vid: "did:example:vti-emit-client", transportAddress: "in-process", keyCustody: "iut" as const }]));
  }
  async trust(): Promise<void> {}
  async setClock(): Promise<void> {
    this.refused();
  }
  async advance(): Promise<void> {
    this.refused();
  }
  async send(_p: SendParams): Promise<SendResult> {
    return this.refused();
  }
  async trigger(): Promise<{ documents: string[] }> {
    return this.refused();
  }
  async observe(_q: ObserveQuery): Promise<ObserveResult> {
    return this.refused();
  }
  async restart(): Promise<void> {
    this.refused();
  }
  async reset(): Promise<void> {}
  async snapshot(): Promise<string> {
    return "none";
  }
  async diff(): Promise<{ changed: boolean }> {
    return { changed: false };
  }
  async verifyProof(): Promise<never> {
    return this.refused();
  }
  async shutdown(): Promise<void> {
    await fetch(`${this.o.controlUrl}/ctl/shutdown`, { method: "POST" }).catch(() => undefined);
  }
}
