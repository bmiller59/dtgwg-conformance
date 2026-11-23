// SPDX-License-Identifier: Apache-2.0
// Runs the VTI-authored cases through an implementation's adapter and reports agreement with VTI.
import type { Adapter, Capabilities } from "../adapter/contract.ts";
import { ed25519Signer } from "../crypto/didkey.ts";
import { signDocument } from "../crypto/proof.ts";
import { isObject } from "../util/json.ts";
import { allCases, type CrossCase, type FreshnessCase, type ProofCase } from "./cases.ts";

export type Verdict = "AGREE" | "DISAGREE" | "NOT-RUN";

export interface CaseResult {
  id: string;
  title: string;
  source: string;
  origin: string;
  vtiExpects: string;
  got: string;
  verdict: Verdict;
  /** Why it was not run, or what the implementation answered. */
  detail: string;
}

export interface CrossRun {
  implementation: string;
  version: string;
  results: CaseResult[];
}

const NOT_RUN = (c: CrossCase, detail: string): CaseResult => ({ id: c.id, title: c.title, source: c.source, origin: c.origin, vtiExpects: c.vtiExpects, got: "-", verdict: "NOT-RUN", detail });

async function runProof(adapter: Adapter, caps: Capabilities, c: ProofCase): Promise<CaseResult> {
  if (!caps.optional.includes("proofVerify")) return NOT_RUN(c, "the adapter does not declare proofVerify");
  const { valid } = await adapter.verifyProof({ bytes: JSON.stringify(c.document) });
  const got = valid ? "valid" : "invalid";
  return { id: c.id, title: c.title, source: c.source, origin: c.origin, vtiExpects: c.vtiExpects, got, verdict: got === c.vtiExpects ? "AGREE" : "DISAGREE", detail: "verifyProof on the bytes as received" };
}

function errorCode(reply: string): string | undefined {
  try {
    const d = JSON.parse(reply) as unknown;
    if (isObject(d) && typeof d.type === "string" && d.type.includes("/trust-task-error/") && isObject(d.payload) && typeof d.payload.code === "string") return d.payload.code;
  } catch {
    /* not JSON */
  }
  return undefined;
}

function iso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

async function runFreshness(adapter: Adapter, caps: Capabilities, c: FreshnessCase): Promise<CaseResult> {
  const carrier = caps.carriers.find((k) => k.class === "consequential");
  if (carrier === undefined) return NOT_RUN(c, "the adapter declares no consequential carrier");
  if (caps.optional.includes("clock") && caps.optional.includes("clockFree")) return NOT_RUN(c, "ambiguous clock capabilities");
  await adapter.reset();
  const roles = await adapter.provision(["iut"]);
  const iut = roles.iut;
  if (iut === undefined) return NOT_RUN(c, "the adapter did not provision the roles");
  const signer = ed25519Signer(new Uint8Array(32).fill(0xa1));
  // One instant for the adapter's clock and for every timestamp below, so a clock set to 10.9 s never meets a proof made at 11 s.
  const startIso = new Date().toISOString();
  if (caps.optional.includes("clock")) await adapter.setClock(startIso);
  const now = Date.parse(startIso);
  const doc: Record<string, unknown> = {
    id: `urn:uuid:${c.id.replace(/[^0-9]/g, "").padStart(8, "0")}-0000-4000-8000-000000000088`,
    type: carrier.typeUri,
    issuer: signer.did,
    recipient: iut.vid,
    payload: carrier.validPayload,
  };
  if (c.issuedAtOffset !== null) doc.issuedAt = iso(now + c.issuedAtOffset * 1000);
  if (c.expiresAtOffset !== undefined && c.expiresAtOffset !== null) doc.expiresAt = iso(now + c.expiresAtOffset * 1000);
  const signed = signDocument(doc, signer, { created: now, purpose: "authentication" });
  const res = await adapter.send({ from: { kind: "actor", vid: signer.did }, bytes: JSON.stringify(signed) });
  const code = res.replies.map(errorCode).find((x) => x !== undefined);
  const got = code ?? (res.replies.length > 0 ? "accepted" : "no reply");
  return { id: c.id, title: c.title, source: c.source, origin: c.origin, vtiExpects: c.vtiExpects, got, verdict: got === c.vtiExpects ? "AGREE" : "DISAGREE", detail: res.replies.length === 0 ? "the implementation answered nothing" : "reply read from the first error or response" };
}

export async function runCrossCheck(adapter: Adapter, cases: CrossCase[] = allCases()): Promise<CrossRun> {
  const caps = await adapter.capabilities();
  const results: CaseResult[] = [];
  for (const c of cases) {
    try {
      results.push(c.kind === "proof" ? await runProof(adapter, caps, c) : await runFreshness(adapter, caps, c));
    } catch (e) {
      results.push(NOT_RUN(c, `adapter error: ${(e as Error).message}`));
    }
  }
  return { implementation: caps.implementation ?? caps.name, version: caps.version, results };
}

export function summary(run: CrossRun): { agree: number; disagree: number; notRun: number } {
  const n = (v: Verdict): number => run.results.filter((r) => r.verdict === v).length;
  return { agree: n("AGREE"), disagree: n("DISAGREE"), notRun: n("NOT-RUN") };
}

export function markdown(runs: CrossRun[]): string {
  const lines: string[] = ["# VTI cross-check: agreement with VTI's own material", ""];
  for (const r of runs) {
    const s = summary(r);
    lines.push(`## ${r.implementation}`, "", `${r.version}`, "", `Agree ${s.agree}, disagree ${s.disagree}, not run ${s.notRun}.`, "", "| Case | VTI expects | Implementation | Result | Bytes |", "|---|---|---|---|---|");
    for (const x of r.results) lines.push(`| ${x.id} ${x.title} | ${x.vtiExpects} | ${x.got} | ${x.verdict} | ${x.origin} |`);
    lines.push("");
  }
  return lines.join("\n");
}
