// SPDX-License-Identifier: Apache-2.0
// O-02, O-03: the task's own standing codes. SPEC.md 7.2 lists "validate the payload" (item 2) and "evaluate whatever authorization requirements
// apply" (item 10) without ordering them, and a task's own text names the code for a caller without standing (its front matter `errorCodes`:
// `notMember`, `noAuthority`, `notAuthorized`, ...). A consumer that checks standing first therefore answers that code to a schema-invalid payload,
// exactly as it may answer `permissionDenied`; a payload negative accepts the task's own standing codes beside the two framework codes.
// Kept narrow on purpose: only codes that say the CALLER lacks standing, never an object lookup (`notFound`, `unknownRepo`) or a state code, so a
// consumer that never validates and then fails on a missing object (the reference's `noPayloadValidation` mutant) is still caught.
import { fileURLToPath } from "node:url";
import { loadTaskFacts, localCode } from "./reachable.ts";
import { loadSnapshot } from "../plain/snapshot.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

/** Local names of the front-matter codes that say the caller has no standing for the task (read from every `errorCodes` entry of the 685 task facts and the 1,128 gap snapshot tasks; the meaning of each was read). */
export const STANDING_NAMES: ReadonlySet<string> = new Set([
  "notAdministrator", "notCommunityAdministrator", "notMember", "notAMember", "notAuthorized", "noAuthority", "notAVetter", "notAnApprover", "notFacilitator", "notManager",
  "forbidden", "notOwner", "notTheOwner", "notRequester", "notProposer", "notAuthor", "notEligible",
]);
export const isStandingName = (code: string): boolean => STANDING_NAMES.has(localCode(code));

const root = fileURLToPath(new URL("../..", import.meta.url));
let factsCache: ReturnType<typeof loadTaskFacts> | undefined;
const facts = (): ReturnType<typeof loadTaskFacts> => (factsCache ??= loadTaskFacts(root));

/** Every front-matter error code of a task, with its meaning where the task facts carry it (the gap snapshot carries names only). */
export function frontMatterCodes(typeUri: string): { code: string; meaning: string }[] {
  const uri = typeUri.split("#")[0]!;
  const f = facts().get(uri)?.errorCodes.map((e) => ({ code: e.code, meaning: e.meaning })) ?? [];
  const seen = new Set(f.map((e) => e.code));
  const s = loadSnapshot().tasks.find((t) => t.typeUri === uri)?.errorCodes ?? [];
  return [...f, ...s.filter((c) => !seen.has(c)).map((code) => ({ code, meaning: "" }))];
}

/**
 * The task's own standing codes. A standing gate does not depend on the payload (it answers for the caller), so every one the front matter lists is
 * reachable for any request of the task (the reachable-code rule, reachable.ts: a standing code is covered by accepting it).
 */
export function standingCodes(typeUri: string, _payloadSchema?: unknown, _payload?: unknown): string[] {
  return frontMatterCodes(typeUri).filter((e) => isStandingName(e.code)).map((e) => e.code);
}

/** The sentence a vector adds when it accepts the task's own standing codes. */
export const standingNote = (slugVersion: string, codes: string[]): string[] =>
  codes.length === 0 ? [] : [`specs/${slugVersion}/spec.md front matter errorCodes: ${codes.join(", ")} (the caller's standing): a refusal for it is accepted beside malformedRequest and permissionDenied, because SPEC.md 7.2 items 2 and 10 do not order the payload check against the authorisation check; an object lookup or state code is not accepted`];

/** Local names of codes that report a lookup of a named object (CB vectors whose own code is a validation code accept these: the lookup may run first). */
export const LOOKUP_NAME = /^(notFound|\w*NotFound|unknown\w*|electionUnknown|listUnknown|noGroup|notHeld|\w*NotHeld|noSuch\w+|notBound|namespaceNotBound)$/;

/**
 * Extra codes a CB (behavioural rule) vector accepts besides its rule's own: the task's standing codes always (O-02), and, where the rule's own code is a
 * validation code rather than a lookup, the task's lookup codes for an object the request names (O-04: the lookup may run first, and the suite holds no
 * seeded object). A lookup code whose meaning names a payload member the request does not send cannot fire and is left out.
 */
export function cbExtraCodes(task: { typeUri: string; slug: string; version: string; payloadSchema: unknown }, payload: unknown, own: string[], also: { code: string }[], withLookups = true): { code: string; note: string }[] {
  const have = new Set([...own, ...also.map((a) => a.code)]);
  const props = isObj(task.payloadSchema) && isObj(task.payloadSchema["properties"]) ? Object.keys(task.payloadSchema["properties"] as J) : [];
  const sent = new Set(isObj(payload) ? Object.keys(payload) : []);
  const fires = (meaning: string): boolean => {
    const mentioned = [...meaning.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]!).filter((x) => props.includes(x));
    return !(mentioned.length > 0 && mentioned.every((x) => !sent.has(x)));
  };
  const out: { code: string; note: string }[] = [];
  const at = `specs/${task.slug}/${task.version}/spec.md front matter errorCodes`;
  const ownIsLookup = own.some((c) => LOOKUP_NAME.test(localCode(c)));
  for (const e of frontMatterCodes(task.typeUri)) {
    if (have.has(e.code)) continue;
    if (isStandingName(e.code)) out.push({ code: e.code, note: `${at}: ${e.code} (the caller's standing) is also accepted, as permissionDenied is: SPEC.md 7.2 items 2 and 10 do not order the authorisation check against the task's own checks` });
    else if (withLookups && !ownIsLookup && fires(e.meaning) && LOOKUP_NAME.test(localCode(e.code))) out.push({ code: e.code, note: `${at}: ${e.code} (a lookup of an object the request names) is also accepted: the lookup may run before the check this rule states, and the suite holds no such object; such a pass shows only that the request was refused` });
  }
  return out;
}
