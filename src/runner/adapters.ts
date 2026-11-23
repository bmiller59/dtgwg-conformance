// SPDX-License-Identifier: Apache-2.0
// Adapter specs of the command lines (`--adapter <spec>`, see src/runner/cli.ts): the reference and its variants, mutants, an in-process
// module, or an out-of-process adapter over stdio or HTTP. Shared by the suite runner and the artifact-crossed replay (src/crossed/).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rpcAdapterFromSpec } from "../adapter/client.ts";
import type { Adapter } from "../adapter/contract.ts";
import { ReferenceAdapter } from "../adapters/reference/reference.ts";
import { OobStarterAdapter } from "../adapters/reference/oob-starter.ts";
import { OobApproverAdapter } from "../adapters/reference/oob-approver.ts";
import { OobServiceAdapter } from "../adapters/reference/oob-service.ts";
import { PairAgent, PairMember } from "../adapters/reference/pair-reference.ts";
import { JoinCommunity, JoinMember } from "../adapters/reference/join-reference.ts";
import { DirCommunity, DirMember } from "../adapters/reference/directory-reference.ts";
import { PersonaAgent, PersonaPhone } from "../adapters/reference/persona-reference.ts";
import { VoteCommunity, VoteMember } from "../adapters/reference/vote-reference.ts";
import { RoomsAgent, RoomsCommunity, RoomsMember } from "../adapters/reference/rooms-reference.ts";
import { BallotBox, BallotVoter } from "../adapters/reference/ballot-reference.ts";

export async function makeAdapter(spec: string, timeoutMs?: number): Promise<Adapter> {
  if (/^(stdio|https?):/.test(spec)) return rpcAdapterFromSpec(spec, timeoutMs === undefined ? {} : { timeoutMs });
  if (spec === "reference") return new ReferenceAdapter();
  // The browser role of the sign-in ceremony (group FC-AUT, docs/26 section 4): opens a request, keeps its starter key, reads the match number, redeems.
  if (spec === "reference-starter") return new OobStarterAdapter();
  // The community's service and the member's approver (wallet and agent) of the sign-in ceremony (group FC-AUT): reference-service[:legacy][:mut=<m1+m2>], reference-approver.
  if (spec === "reference-approver") return new OobApproverAdapter();
  if (spec === "reference-service" || spec.startsWith("reference-service:")) {
    const parts = spec.split(":").slice(1);
    return new OobServiceAdapter({ profile: parts.includes("legacy") ? "legacy" : "current", mutants: parts.filter((x) => x.startsWith("mut=")).flatMap((x) => x.slice(4).split("+")) });
  }
  // The member phone and the agent of the paired ceremonies (groups FC-ACL, FC-DEV, FC-VLT, docs/26): reference-member, reference-agent[:mut=<m1+m2>].
  if (spec === "reference-member") return new PairMember();
  // reference-agent:legacy holds a gated task the way deployed agents do (taskFailed with details.reason auth:step_up_required) instead of the next step SPEC 8.6 requires
  if (spec === "reference-agent:legacy") return new PairAgent({ legacyStepUp: true });
  if (spec === "reference-agent" || spec.startsWith("reference-agent:mut=")) return new PairAgent({ mutants: spec.startsWith("reference-agent:mut=") ? spec.slice(20).split("+") : [] });
  // The community (join family, vetting directory) and the member who joins and publishes a vetter profile (groups FC-MBR, FC-IDV, docs/30): reference-community[:mut=<m1+m2>], reference-joiner.
  if (spec === "reference-joiner") return new JoinMember();
  if (spec === "reference-community" || spec.startsWith("reference-community:mut=")) return new JoinCommunity({ mutants: spec.startsWith("reference-community:mut=") ? spec.slice(24).split("+") : [] });
  // The member directory (group FC-DIR, docs/31): reference-dir-community[:legacy][:mut=<m1+m2>] and reference-dir-member.
  if (spec === "reference-dir-member") return new DirMember();
  const dc = /^reference-dir-community(:legacy)?(?::mut=(.+))?$/.exec(spec);
  if (dc !== null) return new DirCommunity({ legacy: dc[1] !== undefined, mutants: dc[2] === undefined ? [] : dc[2].split("+") });
  // The persona ceremony (group FC-PER, docs/31): reference-persona-agent[:legacy][:mut=<m1+m2>] and reference-persona-phone.
  if (spec === "reference-persona-phone") return new PersonaPhone();
  const pa = /^reference-persona-agent(:legacy)?(?::mut=(.+))?$/.exec(spec);
  if (pa !== null) return new PersonaAgent({ legacy: pa[1] !== undefined, mutants: pa[2] === undefined ? [] : pa[2].split("+") });
  // The elections reads (group FC-VOT, docs/31): reference-vote-community[:legacy][:mut=<m1+m2>] and reference-vote-member.
  if (spec === "reference-vote-member") return new VoteMember();
  const vc = /^reference-vote-community(:legacy)?(?::mut=(.+))?$/.exec(spec);
  if (vc !== null) return new VoteCommunity({ legacy: vc[1] !== undefined, mutants: vc[2] === undefined ? [] : vc[2].split("+") });
  // The ballot cast (group FC-BAL, docs/32): reference-ballot-box[:mut=<m1+m2>] and reference-ballot-voter.
  if (spec === "reference-ballot-voter") return new BallotVoter();
  if (spec === "reference-ballot-box" || spec.startsWith("reference-ballot-box:mut=")) return new BallotBox({ mutants: spec.startsWith("reference-ballot-box:mut=") ? spec.slice(25).split("+") : [] });
  // The rooms ceremony (group FC-RMS, docs/32): reference-rooms-community[:legacy][:mut=<m>], reference-rooms-agent[:legacy][:mut=<m>] and reference-rooms-member.
  if (spec === "reference-rooms-member") return new RoomsMember();
  const rc = /^reference-rooms-community(:legacy)?(?::mut=(.+))?$/.exec(spec);
  if (rc !== null) return new RoomsCommunity({ legacy: rc[1] !== undefined, mutants: rc[2] === undefined ? [] : rc[2].split("+") });
  const ra = /^reference-rooms-agent(:legacy)?(?::mut=(.+))?$/.exec(spec);
  if (ra !== null) return new RoomsAgent({ legacy: ra[1] !== undefined, mutants: ra[2] === undefined ? [] : ra[2].split("+") });
  // The harness configures the reference's essential governance for the run: reference-e:<k>:<actor>,<actor>... (docs/04 section 19).
  const e = /^reference-e:(\d+):([A-Z](?:,[A-Z])*)$/.exec(spec);
  if (e !== null) return new ReferenceAdapter({ essential: { minApprovals: Number(e[1]), approvers: e[2]!.split(",") }, name: `reference-e${e[1]}of${e[2]!.split(",").length}` });
  // A party of a multi-party ceremony scenario (docs/25): reference-party:seed=<n>[,k=<k>,approvers=<A+B+..>][,cosign][,dv=0.1|0.2|0.1+0.2][,attested][,vetting][,onboarding][,mut=<m1+m2>]. The seed gives it its own key; k and approvers
  // are the essential governance it declares; attested: the replies and pushed documents it emits are signed (a credential exchange needs it); cosign: a begin does not count as the proposer's own approval; mut: deliberate mutants.
  if (spec.startsWith("reference-party:")) {
    const kv = new Map(spec.slice(16).split(",").map((x) => { const [k, ...v] = x.split("="); return [k!, v.join("=")] as const; }));
    const seed = Number(kv.get("seed"));
    if (!Number.isInteger(seed) || seed < 1 || seed > 255) throw new Error("reference-party: seed=<1..255> is required");
    const approvers = kv.get("approvers")?.split("+");
    return new ReferenceAdapter({
      signerSeed: seed, name: `reference-party-${seed}`,
      ...(kv.has("k") || approvers !== undefined ? { essential: { minApprovals: Number(kv.get("k") ?? 1), approvers: approvers ?? ["A"] } } : {}),
      ...(kv.has("attested") ? { attested: true } : {}),
      ...(kv.has("vetting") ? { vetting: true } : {}),
      ...(kv.has("onboarding") ? { onboarding: true } : {}),
      ...(kv.has("cosign") ? { proposerApproves: false } : {}),
      ...(kv.has("dv") ? { consentDecisionVersions: kv.get("dv")!.split("+") as ("0.1" | "0.2")[] } : {}),
      ...(kv.has("mut") ? { mutants: kv.get("mut")!.split("+") } : {}),
    });
  }
  // A second reference party with its own key (the producer side of an artifact-crossed replay, src/crossed/).
  if (spec === "reference-peer") return new ReferenceAdapter({ signerSeed: 0x50, name: "reference-peer" });
  if (spec.startsWith("mutant-peer:")) return new ReferenceAdapter({ signerSeed: 0x50, mutants: spec.slice(12).split(",") });
  if (spec === "reference-clockfree") return new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" });
  if (spec === "reference-window10") return new ReferenceAdapter({ window: { maxAgeSeconds: 600 }, name: "reference-window10" });
  if (spec === "reference-attested") return new ReferenceAdapter({ attested: true, name: "reference-attested" });
  if (spec === "reference-cosign") return new ReferenceAdapter({ proposerApproves: false, name: "reference-cosign" });
  // The witness oracle in its labelled mode (docs/25 section 6.4): mints a Verifiable Witness Credential for a presentation that verifies. For the ceremony scenario FC-WSH only.
  // Never the `reference-witness` that the witness vectors run against.
  if (spec.startsWith("reference-witness:")) {
    const kv = new Map(spec.slice(18).split(",").map((x) => { const [k, ...v] = x.split("="); return [k!, v.join("=")] as const; }));
    if (kv.get("mode") !== "mint-on-verified") throw new Error("reference-witness: mode=mint-on-verified is the only option");
    const seed = kv.has("seed") ? Number(kv.get("seed")) : 0x57;
    return new ReferenceAdapter({ witness: true, witnessMode: "mint-on-verified", vrc: false, ceremony: false, dtg: false, plain: false, signerSeed: seed, name: "reference-witness-mint-on-verified", ...(kv.has("mut") ? { mutants: kv.get("mut")!.split("+") } : {}) });
  }
  if (spec === "reference-witness") return new ReferenceAdapter({ witness: true, vrc: false, ceremony: false, dtg: false, plain: false, name: "reference-witness" });
  if (spec === "reference-status") return new ReferenceAdapter({ ceremonyStatus: true, name: "reference-status" });
  if (spec.startsWith("mutant:")) return new ReferenceAdapter({ mutants: spec.slice(7).split(",") });
  if (spec.startsWith("mutant-witness:")) return new ReferenceAdapter({ witness: true, vrc: false, ceremony: false, dtg: false, plain: false, name: "reference-witness", mutants: spec.slice(15).split(",") });
  if (spec.startsWith("mutant-attested:")) return new ReferenceAdapter({ attested: true, mutants: spec.slice(16).split(",") });
  if (spec.startsWith("module:")) {
    const mod = (await import(pathToFileURL(resolve(spec.slice(7))).href)) as { createAdapter?: () => Adapter | Promise<Adapter> };
    if (typeof mod.createAdapter !== "function") throw new Error("module must export createAdapter()");
    return mod.createAdapter();
  }
  throw new Error(`unknown adapter spec ${spec}`);
}

export async function closeAdapter(a: Adapter): Promise<void> {
  const c = (a as { close?: () => Promise<void> }).close;
  if (typeof c === "function") await c.call(a);
}
