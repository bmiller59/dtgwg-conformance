// SPDX-License-Identifier: Apache-2.0
// Writes vectors/governance/gov.json (docs/17). Run: node --experimental-strip-types scripts/generate-governance.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentDigest, governanceCandidate, SUITE_ROOT, withSpecHashes } from "../src/vectors/source.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { EVALUATE, GOV_FORMAT, GRANT, LIST } from "../src/governance/probes.ts";
import type { GovProbe } from "../src/governance/probes.ts";

const PKG = "0.29.0";
const src = (slug: string, version: string, typeUri: string, note: string): VectorSource => {
  const tfRef = tfRefFor(`pkg:@openvtc/trust-tasks@${PKG}#${typeUri}`);
  if (tfRef === null) throw new Error(`no Trust Tasks reference for ${typeUri}`);
  const candidate = governanceCandidate();
  const ref = `suite:${candidate.localText}`;
  // a candidate rests on suite-local text (the governance declaration, docs/17), so its drift tracks that document; tfRef names the TF task the probe drives
  return withSpecHashes({ slug, version, channel: "candidate", ref, pinnedDigest: currentDigest(ref, { suite: SUITE_ROOT }), tfRef, candidate, note });
};
const PROPOSED = "The task text is in the registry package; the declaration the probe makes (governance capability, declareGovernance) is a suite proposal with no task-force home, so the probe is a candidate (decision 79 by the project owner; tfRef names the draft task it drives). Docs/17.";
const NO_GOV = "Governance is the deployment's choice, never the suite's (docs/02 section 5.1): this probe fixes no role name, meaning, authority rule or number; every governance value is a nonce the probe declares, and the result is advisory.";

const probes: Omit<GovProbe, "probe">[] = [
  {
    id: "GOV-D-001", kind: "differential", scenario: "role-vocabulary", declares: ["roles", "authority"], requires: [GRANT, LIST],
    title: "A declared role name is accepted, held and listed under that name",
    spec: [
      "acl/grant 0.3 AclEntry.role: an opaque identifier interpreted by the ACL maintainer; a role not recognised confers nothing (@openvtc/trust-tasks 0.29.0, payload schema description)",
      "docs/17 section 4: the declaration {roles, principals, authority} is a suite proposal",
      NO_GOV,
    ],
    source: src("acl/grant", "0.3", GRANT, PROPOSED), evidence: ["V1", "V1b", "K1"],
  },
  {
    id: "GOV-D-002", kind: "default", scenario: "unknown-role", declares: ["roles", "authority"], requires: [GRANT, LIST],
    title: "A role that was not declared is refused and no entry is held for it",
    spec: [
      "acl/grant 0.3 AclEntry.role: a consumer that does not recognise the role MUST treat the entry as conferring no authority and MUST NOT fall back to a default role (@openvtc/trust-tasks 0.29.0, payload schema description)",
      "docs/17 section 4: the harness gives the platform a declared role set and a granter, then asks for a role outside it",
      NO_GOV,
    ],
    source: src("acl/grant", "0.3", GRANT, PROPOSED), evidence: ["V2", "SPEC-V1", "SPEC-V2"],
  },
  {
    id: "GOV-D-003", kind: "differential", scenario: "authority-rule", declares: ["roles", "authority"], requires: [GRANT],
    title: "A declared who-may-grant-what rule decides each grant as declared",
    spec: [
      "acl/grant 0.3: the granter's own entry bounds what it may grant; the ordering of roles is the maintainer's (@openvtc/trust-tasks 0.29.0, payload schema description)",
      "docs/17 section 4: the harness declares an authority rule over nonce roles and compares each outcome with it only",
      NO_GOV,
    ],
    source: src("acl/grant", "0.3", GRANT, PROPOSED), evidence: ["V3", "T6"],
  },
  {
    id: "GOV-D-004", kind: "differential", scenario: "consent-values", declares: ["roles", "consent"], requires: [EVALUATE],
    title: "A declared consent rule is stated with its declared quorum and requester rule, and no value is supplied for it",
    spec: [
      "policy/_shared 0.4: requireConsent.minApprovals and requireConsent.excludeRequester are REQUIRED with no default (SPEC 6.6 rule 5: a shared component supplies no governance default) (@openvtc/trust-tasks 0.29.0, policy/evaluate 0.4 response schema)",
      "docs/17 section 4: the harness declares a consent rule twice with different values and reads the decision back",
      NO_GOV,
    ],
    source: src("policy/evaluate", "0.4", EVALUATE, PROPOSED), evidence: ["V6", "V9", "K4"],
  },
  {
    id: "GOV-D-005", kind: "default", scenario: "undeclared-principal", declares: ["roles", "authority"], requires: [GRANT, LIST],
    title: "A principal the declaration does not name is not treated as holding a role",
    spec: [
      "acl/grant 0.3: the granter's own stored entry bounds a grant; a party with no entry has no ceiling to exercise (@openvtc/trust-tasks 0.29.0, payload schema description)",
      "docs/17 section 4: the harness sends a grant from an actor the declaration does not name",
      NO_GOV,
    ],
    source: src("acl/grant", "0.3", GRANT, PROPOSED), evidence: ["V2", "SPEC-V1", "SPEC-V2"],
  },
];

// Output directory: the first argument (default vectors/governance), so the freshness test and `npm run regen -- --check` can write elsewhere.
const dir = process.argv[2] !== undefined ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), "..", "vectors", "governance");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "gov.json"), JSON.stringify({ format: GOV_FORMAT, group: "GOV", probes: probes.map((p): GovProbe => ({ ...p, probe: true })) }, null, 2) + "\n");
console.log(`wrote ${probes.length} probes`);
