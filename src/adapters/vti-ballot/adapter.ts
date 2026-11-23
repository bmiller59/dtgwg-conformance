// SPDX-License-Identifier: Apache-2.0
// The ballot box of VTI (`vti-voting-service`), in process, as a ceremony participant (docs/32, group FC-BAL, role `ballot-box`). The host (host/) runs the service's own router on a loopback port (the HTTPS door a cast is sent to) and a control
// interface; this adapter relays each document the runner hands it to the door unchanged and reads the answer, drives the community's side (register, close) through the control interface, and reads the board through it.
import type { Adapter, Capabilities, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";

const SPEC = "https://trusttasks.org/spec/";
export class VtiBallotAdapter implements Adapter {
  private info?: { door: string; boxDid: string; communityDid: string };
  private readonly cfg: { controlUrl: string; version: string; name?: string };
  constructor(cfg: { controlUrl: string; version: string; name?: string }) { this.cfg = cfg; }
  private async ctl(path: string, body: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const r = await fetch(`${this.cfg.controlUrl}/ctl/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as Record<string, any>;
  }
  private async load(): Promise<{ door: string; boxDid: string; communityDid: string }> { return (this.info ??= (await this.ctl("info")) as { door: string; boxDid: string; communityDid: string }); }
  async capabilities(): Promise<Capabilities> {
    return { name: this.cfg.name ?? "vti-ballot-box", implementation: "vti-voting-service", version: this.cfg.version, tierMax: 1, bindings: ["https"], supportedTypes: [`${SPEC}voting/ballot/cast/0.1`], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "trigger.openElection"], ceremonyRoles: [{ ceremony: "FC-BAL", roles: ["ballot-box"] }], pins: { framework: "0.6.0", error: "0.6", binding: "https/0.2" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const i = await this.load();
    return Object.fromEntries(roles.map((r) => [r, { vid: i.boxDid, didDocument: { id: i.boxDid }, transportAddress: i.door, keyCustody: "iut" as const }]));
  }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* the door stays up */ }
  async snapshot(): Promise<string> { return String((await this.ctl("observe", { kind: "casts" })).value); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(_p: { bytes: string }): Promise<ProofVerifyResult> { throw new Error("not supported"); }
  async reset(): Promise<void> { await this.ctl("reset"); }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "openElection") { const r = await this.ctl("election", args); if (r.error !== undefined) throw new Error(`openElection: ${JSON.stringify(r)}`); return { documents: [] }; }
    if (action === "closeElection") { const r = await this.ctl("close", args); if (r.status !== 200) throw new Error(`closeElection: ${JSON.stringify(r)}`); return { documents: [] }; }
    throw new Error(`the ballot box has no trigger ${action}`);
  }
  async send(p: SendParams): Promise<SendResult> {
    const i = await this.load();
    const r = await fetch(i.door, { method: "POST", headers: { "content-type": "application/json" }, body: p.bytes });
    const text = await r.text();
    const isDoc = text.trim().startsWith("{");
    return { replies: isDoc ? [text] : [], transport: { status: r.status, kind: isDoc ? "document" : "refused" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query !== "stored") throw new Error(`the ballot box does not answer ${q.query}`);
    if (q.kind === "casts" || q.kind === "counted") return { value: Number((await this.ctl("observe", { kind: q.kind })).value) };
    throw new Error(`the ballot box does not answer stored ${q.kind}`);
  }
}
