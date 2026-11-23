// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family VP (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import type { BehaviourRule, J } from "./types.ts";
import { unknownIdRule } from "./types.ts";

const F = "VP";
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = (v: unknown): J => JSON.parse(JSON.stringify(v)) as J;
const q = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;

/** An identifier member that names nothing (the helper builds the payload). */
function unknown(slug: string, version: string, member: string, code: string, words: string, suffix?: string): BehaviourRule {
  return unknownIdRule({ family: F, slug, version, member, code, quote: [q(slug, version, words)], ...(suffix === undefined ? {} : { suffix }) });
}

/** A rule over a payload edited from the task's valid payload: `edit` builds the trigger, `refuses` is the oracle's test. */
function custom(o: { also?: BehaviourRule["alsoAccept"]; slug: string; version: string; code: string; suffix?: string; title: string; words: string[]; codes?: string[]; edit: (p: J) => J | undefined; refuses: (p: J) => boolean }): BehaviourRule {
  return {
    key: `${o.slug}/${o.version}:${o.code}${o.suffix ?? ""}`, family: F, slug: o.slug, version: o.version, title: `${o.slug} ${o.version}: ${o.title}`,
    quote: o.words.map((w) => q(o.slug, o.version, w)), codes: o.codes ?? [`${o.slug}:${o.code}`], ...(o.also === undefined ? {} : { alsoAccept: o.also }),
    trigger: (t) => (isObj(t.validPayload) ? o.edit(clone(t.validPayload)) : undefined),
    refuses: (p) => { try { return o.refuses(p); } catch { return false; } },
  };
}

/**
 * O-04: the vote task's consumer rules run in the order its text lists them (SPEC 7.2 item 10 leaves the order of authority and task checks to the
 * deployment, and the vote text puts the ticket lookup, item 3, before the manifest checks, item 4, the voting key, item 5, the window, item 6, and
 * the ballot, item 7). The suite holds no ticket (a seeded ticket needs a whole voter/register and voter/accept ceremony, a state the CB rows never
 * build), so a conforming engine answers notFound to every one of these requests; the ballot rows also meet a placeholder voting key it cannot
 * decode (parametersInvalid) and a manifest window that is not open (notOpen). Each earlier code the text lists is accepted, with its words.
 */
const voteWords = {
  notFound: "refuse with `vta/pcs/vote:notFound` if it holds no ticket for",
  parametersInvalid: "Refuse with `vta/pcs/vote:parametersInvalid` a `votingKey` it cannot decode",
  notOpen: "Refuse with `vta/pcs/vote:notOpen` when its clock is before the manifest's `votingOpensAt`",
};
const voteAlso = (v: string, ...codes: (keyof typeof voteWords)[]): NonNullable<BehaviourRule["alsoAccept"]> => codes.map((c) => ({ code: `vta/pcs/vote:${c}`, quote: q("vta/pcs/vote", v, voteWords[c]) }));
/** O-04: voter/register item 3 (suite, then a voting key it cannot decode) runs before the item 9 `member` check. */
const registerAlso = (v: string): NonNullable<BehaviourRule["alsoAccept"]> => [
  { code: "vta/pcs/voter/register:unsupportedSuite", quote: q("vta/pcs/voter/register", v, "Refuse a suite it does not implement with `vta/pcs/voter/register:unsupportedSuite`") },
  { code: "vta/pcs/voter/register:parametersInvalid", quote: q("vta/pcs/voter/register", v, "a `votingKey` it cannot decode with `vta/pcs/voter/register:parametersInvalid`") },
];

const NOT_FOUND_ENGINE = "No vetter engine exists for this context and community.";
const NOT_FOUND_APP = "No application has this handle in a context the caller may act in.";
const UNKNOWN_KEY = "none for a key the manifest does not name";

export const RULES: BehaviourRule[] = [
  // ---- vetting (applicant and vetter)
  unknown("vetting/decline", "0.1", "requestId", "vetting/decline:unknownRequest", "The applicant has no open request with this vetter under the named requestId."),
  unknown("vetting/session", "0.1", "requestId", "vetting/session:unknownRequest", "This vetter holds no accepted vetting request from this applicant with the named requestId."),
  // ---- voting: the ballot box
  unknown("voting/ballot/cast", "0.1", "electionId", "voting/ballot/cast:electionUnknown", "No election with this identifier exists for this community."),
  custom({
    slug: "voting/ballot/cast", version: "0.1", code: "manifestMismatch", title: "a ballot that names another election than electionId is refused with manifestMismatch",
    words: ["Refuse with `voting/ballot/cast:manifestMismatch` unless `cast.ballot.electionId` is `electionId`"],
    edit: (p) => { (p["cast"] as J)["ballot"] = { ...((p["cast"] as J)["ballot"] as J), electionId: "conformance-other-election" }; return p; },
    refuses: (p) => ((p["cast"] as J)["ballot"] as J)["electionId"] !== p["electionId"],
  }),
  // ---- the PCS engine of the vetter
  unknown("vta/pcs/vetter/show", "0.1", "contextId", "vta/pcs/vetter/show:notFound", NOT_FOUND_ENGINE),
  unknown("vta/pcs/attest", "0.1", "contextId", "vta/pcs/attest:notFound", NOT_FOUND_ENGINE),
  unknown("vta/pcs/root-accept", "0.1", "contextId", "vta/pcs/root-accept:notFound", NOT_FOUND_ENGINE),
  unknown("vta/pcs/tokens/abandon", "0.1", "contextId", "vta/pcs/tokens/abandon:notFound", NOT_FOUND_ENGINE),
  unknown("vta/pcs/tokens/accept", "0.1", "contextId", "vta/pcs/tokens/accept:notFound", NOT_FOUND_ENGINE),
  unknown("vta/pcs/tokens/request", "0.1", "contextId", "vta/pcs/tokens/request:notFound", NOT_FOUND_ENGINE),
  custom({
    slug: "vta/pcs/vetter/recover", version: "0.1", code: "notFound", title: "a boundId no key the VTA can derive has is refused with notFound",
    words: ["No key this VTA can derive for the context has the PCS identifier"],
    edit: (p) => { const b = String(p["boundId"]); p["boundId"] = b.slice(0, -1) + (b.endsWith("2") ? "3" : "2"); return p; },
    refuses: (p) => typeof p["boundId"] === "string" && p["boundId"] !== "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d",
  }),
  custom({
    slug: "vta/pcs/tokens/request", version: "0.1", code: "countExceedsDrip", title: "a count above the parameters' dripPerTick is refused with countExceedsDrip",
    words: ["`count` is more than the parameters' `dripPerTick`."], codes: ["vta/pcs/tokens/request:countExceedsDrip", "vta/pcs/tokens/request:notFound"],
    edit: (p) => { const par = p["parameters"] as J; par["tokenLabels"] = [p["label"]]; p["count"] = (par["dripPerTick"] as number) + 1; return p; },
    refuses: (p) => typeof p["count"] === "number" && typeof (p["parameters"] as J)["dripPerTick"] === "number" && p["count"] > ((p["parameters"] as J)["dripPerTick"] as number),
  }),
  // ---- applications (the applicant's PCS side)
  unknown("vta/pcs/applications/show", "0.1", "applicationId", "vta/pcs/applications/show:notFound", NOT_FOUND_APP),
  unknown("vta/pcs/prove", "0.1", "applicationId", "vta/pcs/prove:notFound", NOT_FOUND_APP),
  unknown("vta/pcs/verify-attestation", "0.1", "applicationId", "vta/pcs/verify-attestation:notFound", NOT_FOUND_APP),
  // ---- the voter's PCS engine
  ...(["0.2", "0.3", "0.4"] as const).flatMap((v) => [
    unknown("vta/pcs/vote", v, "contextId", "vta/pcs/vote:notFound", "The engine holds no ticket for this election in this context and community."),
    custom({
      slug: "vta/pcs/vote", version: v, code: "manifestMismatch", suffix: "Community", also: voteAlso(v, "notFound"), title: "a manifest that names another community than community is refused with manifestMismatch",
      words: ["the manifest names another community"],
      edit: (p) => { (p["manifest"] as J)["community"] = "did:web:conformance-other.example"; return p; },
      refuses: (p) => (p["manifest"] as J)["community"] !== p["community"],
    }),
    custom({
      slug: "vta/pcs/vote", version: v, code: "manifestMismatch", suffix: "BallotElection", also: voteAlso(v, "notFound"), title: "a ballot whose electionId is not the manifest's is refused with manifestMismatch",
      words: ["the ballot's `electionId` or `manifestDigest` is not the manifest's"],
      edit: (p) => { (p["ballot"] as J)["electionId"] = "conformance-other-election"; return p; },
      refuses: (p) => (p["ballot"] as J)["electionId"] !== (p["manifest"] as J)["electionId"],
    }),
    custom({
      slug: "vta/pcs/vote", version: v, code: "ballotInvalid", also: voteAlso(v, "notFound", "parametersInvalid", "notOpen"), title: "a ballot with an answer for a key the manifest does not name is refused with ballotInvalid",
      words: [UNKNOWN_KEY],
      edit: (p) => { const a = (p["ballot"] as J)["answers"] as J[]; a[0] = { ...a[0]!, question: "conformance-unnamed-question" }; return p; },
      refuses: (p) => { const keys = new Set(((p["manifest"] as J)["questions"] as J[]).map((x) => x["key"])); return ((p["ballot"] as J)["answers"] as J[]).some((a) => !keys.has(a["question"])); },
    }),
  ]),
  unknown("vta/pcs/vote-encrypted", "0.5", "contextId", "vta/pcs/vote-encrypted:notFound", "The engine holds no ticket for this election."),
  unknown("vta/pcs/voter/accept", "0.1", "electionId", "vta/pcs/voter/accept:notFound", "The engine records no ticket request for this election in this context and community"),
  unknown("vta/pcs/voter/receipt", "0.1", "electionId", "vta/pcs/voter/receipt:notFound", "The engine records no election in this context and community for which it accepted a ticket."),
  ...(["0.2", "0.3", "0.5"] as const).map((v) => ({ ...unknown("vta/pcs/voter/register", v, "member", "vta/pcs/voter/register:memberNotHeld", "`member` names a DID the engine holds no `authentication` key of, or one the caller may not act as."), alsoAccept: registerAlso(v) })),
  unknown("vta/pcs/voter/read", "0.6", "member", "vta/pcs/voter/read:memberNotHeld", "`member` names a DID the engine holds no `authentication` key of, or one the caller may not act as."),
  // ---- trustees (newest versions only: no keyring-wallet use)
  unknown("vta/pcs/trustee/read", "0.4", "trustee", "vta/pcs/trustee/read:trusteeNotHeld", "`trustee` names a DID the engine holds no `authentication` key of, or one the caller may not act as."),
  ...([["deal", "0.5"], ["decrypt", "0.2"], ["enrol", "0.4"], ["justify", "0.5"], ["keys", "0.5"]] as const).map(([s, v]) =>
    unknown(`vta/pcs/trustee/${s}`, v, "trustee", `vta/pcs/trustee/${s}:trusteeNotHeld`, "The VTA holds no `authentication` key of `trustee` that the caller may act as")),
  // ---- the community side
  unknown("vtc/elections/show", "0.2", "electionId", "vtc/elections/show:electionUnknown", "No election with this identifier exists for this community"),
  unknown("vtc/elections/show", "0.3", "electionId", "vtc/elections/show:electionUnknown", "No election with this identifier exists for this community"),
  unknown("vtc/elections/show", "0.6", "electionId", "vtc/elections/show:electionUnknown", "No election with this identifier exists for this community"),
  unknown("vtc/vetting/vetters/grant", "0.1", "memberDid", "vtc/vetting/vetters/grant:notMember", "Refuses a `memberDid` that is not an active member with `vtc/vetting/vetters/grant:notMember`"),
];
