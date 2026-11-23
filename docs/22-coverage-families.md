# Coverage families: every trust task keyring-wallet and VTI use

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

> **A PASS that is only `permissionDenied` shows an authorisation gate answered first, not that the stated rule held: only a PASS with the task's own code carries the evidence for the rule.** The runner records which code each behavioural PASS returned (`observedCodes`, and `acceptedOnlyGate` when every error step answered `permissionDenied`), and the coverage page splits each recorded run's PASS count into those two kinds, per surface and per group. A run recorded before the runner kept the code prints "not recorded": the split is never guessed from the PASS count. Both fields are informational: no headline count, total or exit code uses them, and a registry result never carries them.

This page describes the coverage families: vectors for each Trust Task type that keyring-wallet or VTI uses, grouped into eight families by domain (RM, VP, MB, CS, SD, AA, CA, PW). The decisions behind them are CV-1 to CV-13 in [decisions](decisions/03-vectors-and-coverage.md#coverage-families-trust-tasks-keyring-wallet-and-vti-use).

## What they are

- The list of used types is `vectors-src/coverage/task-census.tsv` (660 types, one row per slug and version). `npm` script `node scripts/task-census.ts` joins it to the vectors the suite holds. Its `kw_role` column says what keyring-wallet does with each type its source names (see below).
- The vectors are in `vectors/coverage/`, written by `scripts/generate-coverage.ts`. They are channel `proposed` (a Trust Tasks specification exists) or `candidate` (none exists). Since batch B1 of 2026-11-20 a promoted vector is `registry` (it gates), through the promotion record `vectors-src/promotions.json` and the `source.promotion` member, with its former channel and profile kept; the generator still derives `proposed` or `candidate` for the rest ([docs/33](33-registry-promotion.md)).
- They are left out of every default run and every headline count. Run them with `--vectors vectors/coverage --channels proposed,candidate`; results are advisory.
- **Latest versions are the focus (decision D245, 2026-11-20).** The target is the latest non-retired version of each task. Coverage vectors written for an older version stay in the repository and stay runnable, labelled `older (non-focus)`; a platform skip of an older version is reach class `scope`, not `platform`, and the figures below count the latest versions in their own columns ("Latest versions used", "Latest with any vector"). The all-versions columns are kept beside them (the earlier grain), not removed.

## keyring-wallet figures: what each one measures

A wallet is a client, so three different figures are quoted for it, and each is defined once here.

1. **Census (task-census.tsv, version grain).** The wallet sends 164 of 191 types, receives 14 and declares 13 more. It says what the wallet's source does, not what ran.
2. **Vector existence.** "163 of 164 have a vector (99%)" counts that a vector exists for the type, not that it was run.
3. **Role-level reach (decisions D300 to D303).** The coverage matrix (`npm run coverage-matrix`) reads run records only through the explicit map [results/platform-run-map.json](../results/platform-run-map.json) (run folder to platform, surface, checkout; it also lists the ceremony rows that had the wallet), replays every mapped run, and reports a slug as `covered` when a vector of its latest version executed in some run. The earlier matrix matched run folders by name and read two of the wallet's folders (7 covered of 862, 112 not run); the map reads them all (88 covered, 774 skip, 0 not run). The denominator is the slugs where the wallet has a role in code (135: 12 serves, 105 emits, 14 only at a lower version, 4 names only; `results/coverage/kw-roles.json`, derived from the wallet source with comments stripped and the rules in `results/coverage/kw-role-rules.json`): 87 covered. The remaining 727 slugs are reach class `not-built` (361: families a wallet could use and its source does not) or `not-involved` (366: service and operator surfaces), beside `platform` and `scope`; they are not counted as skips. The per-slug table (role, code evidence, emit vector, consumer vector, ceremony overlay, result) is results/coverage/kw-participation.md. Ceremony run records are an overlay in that table and never a conformance count. The role rules for slugs the source does not name are judgement by prefix and say so; the roles of named slugs are code evidence.

The matrix is not part of `npm run regen`: regenerate it with `npm run coverage-matrix -- ... --runs <results dir> --runs <other run folders> --run-map results/platform-run-map.json` (command in decisions D300) before `regen` whenever inputs move. The same map fixes the matching gap for VTI (VTI 433 to 510, no run read as not run); roles for VTI are not derived yet (follow-up).

## Valid payloads and what is not generated

A probe that sends a valid request needs a payload that satisfies the task's payload schema. The suite builds one from the schema (`src/plain/schema.ts`): the plain builder `example`, and, for a version it cannot build, `exampleExtended` (decision CV-12). Of the 645 census task versions, 517 were built by `example` or by a hand override taken from the schema's own description (`src/adapters/reference/2l-catalog.ts`); the extended pass builds the other 128, so all 645 now have a valid payload. The causes it removes, by version:

| Cause | Versions |
|---|---|
| a `pattern` the plain builder had no candidate string for (identifiers, UUIDs, base58 and base64url strings, prefixed handles); the extended pass builds a string from the regular expression itself (`src/plain/pattern.ts`) | 92 |
| an open object with `minProperties` and no named members (an opaque document the framework does not define), keys taken from `propertyNames` | 21 |
| a `oneOf` whose alternatives only name members (`required`, `not`) that the enclosing schema describes | 15 |
| two of these together (pattern with nesting deeper than the plain limit, pattern with an open object, pattern with a `oneOf`, a `oneOf` with an open object) | 4 |

`exampleExtended` runs `example` first and changes nothing it builds, so no vector of a version that already built has changed. A version built only by the extended pass gets its probe vectors numbered after every other probe of its family (the id ledger is append-only), and its payload members are placeholders that satisfy the schema: they are not claims about what the task does. Where the schema leaves an opaque member (a signed request, a presentation), the extended pass supplies a placeholder key and string value and reads no value from a description.

`vectors/coverage/not-generated.json` lists the used types the generator leaves out, wholly or in part: types held elsewhere, types with no specification, a retired specification, and any version whose payload the builder cannot build (none at present). The reason `payload-not-buildable` is kept for that case.

## Vectors and types by family

The figures below are generated by `npm run regen` (`scripts/coverage-pages.ts`) from the census and the vector files, at version grain (one row per task type, slug plus version; decision CV-8). The page results/coverage.md adds the task-grain figure beside them, the limits, and, when a folder of coverage run records is given (`COVERAGE_RUNS_DIR`), which types ran on each recorded surface and how many of its PASSes returned the task's own code against `permissionDenied` only. A group is `CV` (payload and policy checks), `CB` (behavioural), `CE` (what a platform sends) or `CX` (the task force's own invalid examples).

<!-- generated:coverage-counts -->
| Family | Types used | Latest versions used (focus) | Older versions used (non-focus) | keyring-wallet sends (headline) | keyring-wallet uses (all, earlier figure) | VTI | both (all used) | With any vector | Latest with any vector | With a behavioural vector (CB) | CV vectors | CB vectors | CE vectors | CX vectors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RM Rooms | 84 | 52 (62%) | 32 | 28 | 31 | 76 | 23 | 84 (100%) | 52 (100%) | 39 (46%) | 211 | 48 | 23 | 64 |
| VP Vetting, process attestation and voting | 71 | 48 (68%) | 22 | 34 | 37 | 57 | 23 | 70 (99%) | 48 (100%) | 33 (46%) | 195 | 44 | 9 | 14 |
| MB Membership and directory | 83 | 79 (95%) | 4 | 20 | 26 | 76 | 19 | 83 (100%) | 79 (100%) | 12 (14%) | 169 | 14 | 1 | 54 |
| CS Consent and step-up | 25 | 17 (68%) | 8 | 6 | 13 | 14 | 2 | 25 (100%) | 17 (100%) | 10 (40%) | 22 | 12 | 0 | 7 |
| SD Session, device, vault, keys, access and policy | 116 | 82 (71%) | 30 | 54 | 58 | 90 | 32 | 112 (97%) | 82 (100%) | 21 (18%) | 64 | 29 | 0 | 10 |
| AA Agent administration | 139 | 118 (85%) | 16 | 13 | 15 | 134 | 10 | 135 (97%) | 118 (100%) | 43 (31%) | 294 | 44 | 2 | 44 |
| CA Community administration | 133 | 126 (95%) | 7 | 0 | 0 | 133 | 0 | 133 (100%) | 126 (100%) | 27 (20%) | 326 | 28 | 0 | 132 |
| PW Peer ceremony wire | 5 | 2 (40%) | 2 | 5 | 5 | 0 | 0 | 5 (100%) | 2 (100%) | 0 (0%) | 0 | 0 | 4 | 0 |
| FW Framework tasks (not a coverage family) | 6 | 2 (33%) | 4 | 4 | 6 | 1 | 1 | 5 (83%) | 2 (100%) | 0 (0%) | 0 | 0 | 0 | 0 |
| **All** | 662 | 526 (79%) | 125 | 164 | 191 | 581 | 110 | 652 (98%) | 526 (100%) | 185 (28%) | 1281 | 219 | 39 | 325 |
<!-- /generated:coverage-counts -->

## Candidate coverage vectors (CC)

A used type with no Trust Tasks specification gets a vector only where a local text exists (decision [CV-6](decisions/03-vectors-and-coverage.md#cv6)); no semantics are invented. The local text is the suite-owned [24-candidate-task-notes.md](24-candidate-task-notes.md), which quotes the platform's own source with file and line anchors relative to the platform repository. The vectors are channel `candidate`, group `CC` (`vectors/coverage/cc-*.json`, written by `scripts/generate-coverage.ts` from `src/coverage/candidates.ts`), mechanics only: a document whose payload breaks the request shape the platform's own source declares is refused; no valid request is sent, so nothing is archived, restored, purged or changed. They are not in the family table above, not in any total, and not in any headline count. A candidate vector is not independent of the platform it quotes. The list below is generated.

<!-- generated:coverage-candidates -->
The 10 used types with no Trust Tasks specification ([CV-6](decisions/03-vectors-and-coverage.md#cv6)). A candidate vector is written only where a local text exists ([24-candidate-task-notes.md](24-candidate-task-notes.md) quotes the platform's own source); a type with no usable text gets no vector and is listed as blocked. 5 types have a new candidate vector (5 vectors in all, group CC); one type is covered by vectors the suite already held. Candidate figures are counted apart from the family table and from every total, and no candidate vector enters a headline count.

| Type | Family | Used by | Candidate vectors | Text, or why none |
|---|---|---|---|---|
| `vta/audit/get-retention/1.0` | AA | VTA | none: blocked on text | the request body is an empty struct, so there is no required member to leave out, and the only request the text describes is a valid one (decision CV-5 leaves it out for administration) |
| `vta/audit/update-retention/1.0` | AA | VTA | 1 candidate vector (CC-AA) | local text docs/24-candidate-task-notes.md |
| `vta/seeds/list/1.0` | AA | VTA | none: blocked on text | the request body is an empty struct, so there is no required member to leave out, and the only request the text describes is a valid one (decision CV-5 leaves it out for administration) |
| `vta/seeds/rotate/1.0` | AA | VTA | none: blocked on text | the only request member is optional, so no required member can be left out, and a valid request rotates the agent's seed (destructive) |
| `vrc/relationships/witness-share/0.1` | PW | KW | vectors already held: vectors/ceremony-vrc/witness-share.json (WSH, 23 vectors; local text docs/10-witness-share-profile.md) | local text docs/10-witness-share-profile.md |
| `vault/archive/0.1` | SD | VTA | 1 candidate vector (CC-SD) | local text docs/24-candidate-task-notes.md |
| `vault/purge/0.1` | SD | VTA | 1 candidate vector (CC-SD) | local text docs/24-candidate-task-notes.md |
| `vault/restore/0.1` | SD | VTA | 1 candidate vector (CC-SD) | local text docs/24-candidate-task-notes.md |
| `vault/unarchive/0.1` | SD | VTA | 1 candidate vector (CC-SD) | local text docs/24-candidate-task-notes.md |
| `vetting/vetters/grant/0.1` | VP | KW | none: blocked on text | the keyring-wallet source mentions the type only in comments about a delivered credential; it states no request payload, response or refusal |
<!-- /generated:coverage-candidates -->

## keyring-wallet: types it sends, types it only receives

A type can be named in the wallet's source without the wallet ever sending it: it may only read it inbound, or only list it in a rule table, a capability declaration or a comment. The census therefore carries a `kw_role` for each wallet row: `sent` (a code path builds and sends it, or it is a step-down version the wallet sends when the agent refuses a newer one), `received`, `both`, or `declared-only`. The evidence for every row is in [vectors-src/coverage/kw-roles-evidence.md](../vectors-src/coverage/kw-roles-evidence.md), read from the wallet's source (the original wallet), and includes the corrections the check made to the earlier list of receive-only types.

The headline keyring-wallet denominator on every coverage figure is the number of types the wallet **sends**, read at the latest versions first (the "Latest versions used" column of the family table; the version-grain columns beside it count every version) (role `sent` or `both`); the earlier figure, every type its source names, is printed beside it. What the suite generates did not change: a CE vector (what a platform sends) is still written for every wallet type, so a received-only or named-only type keeps its CE vector, and the page says which used types are received only. A SKIP of such a vector on a wallet surface is not a gap in the wallet.

<!-- generated:coverage-kw-roles -->
The census names 191 types in the wallet's source. Reading the source for each ([kw-roles-evidence.md](../vectors-src/coverage/kw-roles-evidence.md)) gives the `kw_role` column of the census: the wallet **sends** 164 of them (role `sent` or `both`), and the other 27 it only receives or only names. The headline keyring-wallet figures on this page count the sent types; the all-used figure is printed beside it.

| Role | Types | With any vector |
|---|---|---|
| `sent` | 153 | 152 (99%) |
| `received` | 14 | 14 (100%) |
| `both` | 11 | 11 (100%) |
| `declared-only` | 13 | 12 (92%) |

- **Received only** (the wallet reads them inbound and never builds one), 14 types: `auth/step-up/approve-request/0.1`, `auth/step-up/approve-request/0.2`, `auth/step-up/approve-request/0.3`, `auth/step-up/approve-request/0.4`, `auth/step-up/approve-request/0.5`, `task-consent/granted/0.1`, `task-consent/request/0.1`, `trust-task-error/0.1`, `trust-task-error/0.6`, `vtc/join-requests/submit-receipt/0.1`, `vtc/members/removal-notice/0.1`, `vtc/members/request-vmc/0.1`, `credential-exchange/offer/0.1`, `credential-exchange/query/0.1`.
- **Named only** (a rule list, capability table, phrase table, unused constant, comment or HTTP header; neither sent nor received), 13 types: `vta/contexts/get/1.0`, `vta/webvh/dids/delete/1.0`, `vtc/invitations/deliver/0.1`, `vtc/invitations/issue/0.1`, `vtc/join-requests/decide/0.1`, `rooms/keys/browse/0.2`, `rooms/keys/present/0.2`, `rooms/records/put/0.4`, `keys/revoke/0.1`, `keys/sign/0.1`, `vetting/vetters/grant/0.1`, `vtc/vetting/revoke-statement/0.1`, `vtc/vetting/vetters/list/0.1`.
- **Both** (sent and received), 11 types: `trust-task-discovery/0.1`, `trust-task-error/0.5`, `trust-task-next-step/0.1`, `vrc/relationships/issue/0.1`, `vrc/relationships/propose/0.1`, `vrc/relationships/witness-share/0.1`, `credential-exchange/issue/0.1`, `vetting/attestation/0.1`, `vetting/decline/0.1`, `vetting/request/0.1`, `vetting/session/0.1`.

What is generated is unchanged: the suite still writes a CE vector (what a platform sends) for every type the wallet uses, so a received-only or named-only type has a CE vector that the wallet is never expected to satisfy by sending. A SKIP of such a vector on a wallet surface is not a gap in the wallet.
<!-- /generated:coverage-kw-roles -->

## Task grain and version grain: why the keyring-wallet figures differ

results/coverage.md prints the task-grain figure (the task list behind `results/task-scope.json`, counted by task) beside the version-grain census. Both count slugs when they count tasks, so the version step-down lists do not move the task count; they only make the census count more types than tasks. The two lists were built separately (the task list from an earlier reading of the wallet's source and a named-types file, the census from the source the census was derived from), and they differed in a listed set of tasks. On 2026-11-18, on the project owner's decision ([CV-14](decisions/03-vectors-and-coverage.md#cv14)), the 21 tasks the census marks as sent by the wallet and the task list lacked (the rooms blobs, keys and records tasks, `voting/ballot/cast`, `vta/pcs/vote` and the voter tasks, `vtc/rooms/offers/accept`) were added to `results/task-scope.json` (each marked `since`), and three census rows were added from the wallet's source: `trust-task-discovery/0.1` and `trust-task-next-step/0.1` (framework rows, family FW) and `vtc/join-requests/manifest/0.4` (the wallet's own version list, `MANIFEST_WIRES`, goes to 0.4). The task-grain figure was 104 of 104 before that and is now printed beside the new figure on the coverage page, so the change is explained, not hidden; the headline pages (STATUS.md, README.md) take the new task list. Their "with a check in the suite" figure reads headline vectors only, and the 21 added tasks are held by the advisory coverage vectors, which no headline counts ([CV-3](decisions/03-vectors-and-coverage.md#cv3), [CV-8](decisions/03-vectors-and-coverage.md#cv8)), so it moves from 104 of 104 to 104 of 125 and each surface's "checked on this surface" share falls with the larger denominator (for example 86 of 104 to 86 of 125 on the stand-in carrier). Counting the coverage vectors too, every one of the 125 tasks has a check. The tasks that remain in the census and not in the task list are tasks the wallet only receives or only names.

<!-- generated:coverage-reconcile -->
The task-grain figure counts 125 tasks keyring-wallet uses; the census names 133 distinct tasks (slugs) among 191 wallet types. Both are counts of slugs, so the version step-down lists are not the cause: they raise the type count (34 slugs have more than one wallet version in the census) and leave the slug count alone. The two lists were built separately, the task list from `results/task-scope.json` (65 tasks listed there, 60 more from the named-types file it points at) and the census from the wallet's source, and they differ in exactly these places:

- **In the census, not in the task list: 8 tasks.** 0 of them the wallet sends at some version; 8 it only receives or only names.
- **In the task list, not in the census: 0 tasks.** The census holds no wallet row for them.
- 133 = 125 - 0 + 8.

Read against the sent figure: the census marks 114 tasks as sent by the wallet (164 types), and 0 of those 114 are not in the task list; 11 tasks in the task list the wallet does not send at any version (it receives or only names them). The 21 tasks the wallet sends that the task list lacked were added to `results/task-scope.json` on 2026-11-18 (decision CV-14); the ones left are tasks the wallet only receives or only names, which the task list does not count.

The tasks themselves are listed in the task-grain reconciliation in the generated coverage page.
<!-- /generated:coverage-reconcile -->

## Behavioural rules (CB)

A CB vector checks one refusal that the Trust Tasks text states, reachable from one document. The rules live one file per family in `src/coverage/behaviour/`, and `scripts/generate-coverage.ts` writes one vector per rule. Each rule must hold for its trigger payload and not for the task's valid payload, the trigger must satisfy the payload schema (so it tests the rule, not the schema), and a rule is only written for a type the reference oracle serves that is not destructive. A caller's lack of authority is the deployment's governance, so every CB vector accepts `permissionDenied` in place of the task's own code; no rule is authority-free, because an authorisation gate can answer before any check of the task itself and the framework fixes no order between them (SPEC.md section 7.2 item 10). **A `permissionDenied` answer shows only that an authorisation gate answered first, not that the stated rule held: a PASS on a CB vector means the request was refused, and only a PASS with the task's own code carries the evidence for the rule.** Each vector says this once in its spec text. Where the Trust Tasks text lists a second code for the task and fixes no order (the `notAdministrator` of the admin action tasks, the `unavailable` of the passkey challenge), the vector also accepts it and quotes the words. A trigger document must satisfy what the text says is checked before the rule: values the schema describes as base64url decode, an identifier the platform parses as a DID is one, a signer-bound member names the actor, and members the text compares (`parentThreadId` and `payload.requestId`) agree; `test/coverage-behaviour.test.ts` checks these for every rule. A rule whose stated code appears only after a lookup or an authorisation that needs prior state (an existing room and a presentation that verifies, a key the custodian holds, an open challenge, a published criterion, a subject with a step-up factor, authority evidence the consumer accepts) is not reachable from one document: it is retired (`retired: {reason, since}` on its vector, docs/04 section 20.3), keeping its id and steps as a tombstone that is never run or counted, with the consumer item it rests on in the reason, and it has no oracle behaviour or mutant. Each rule in force has a mutant of the reference oracle that stops enforcing it, so the vector is shown to fail when the rule is not enforced. Rules exist only for the newest version of a task and for versions keyring-wallet uses (decision CV-2); the ten types with no specification have none.

## Seeded-state probe (CP)

A held finding is a platform answer the suite could not classify: a schema-invalid payload that names a room or git namespace the platform does not hold is answered with a not-found (`taskFailed`, `git-ns:unknownNamespace`), so the answer says nothing about whether the payload was validated. The seeded-state probe (decision [CV-16](decisions/03-vectors-and-coverage.md#cv16)) asks again with the object present. Each probe vector first creates the object through the task the platform serves for it (`rooms/create` 0.2, `git-ns/namespace/bind` 0.2, `keys/create` 0.1), signed on the same path as every other step, then sends the held vector's payloads naming the real object. The keys probes need an actor the agent authorises to create a key (`VTI_ACTOR_ROLE`, the deployment's choice, stated in the run README). A probe step keeps a payload only where the identifier it carries is itself valid, so the invalidity under test is never the identifier.

- Files: `vectors/probe/` (groups `CP-RM`, `CP-CA`, `CP-SD`), written by `scripts/generate-probe.ts` from the held vectors in `vectors/coverage/`. Channel `proposed`; left out of every default run, headline count and exit code. Run with `--vectors vectors/probe --channels proposed`.
- Optional capability `seed.defaults`: the platform's own shipped default policies are in force before the first request, as on a deployed instance. The in-process VTC host does not install them (its test-support state omits the call `vtc` makes at start), and without them a community room cannot be created; with `VTI_VTC_SEED_DEFAULTS=1` the host calls the platform's own `install_defaults` through `/ctl/defaults`. Nothing is written to the platform's store by the host. Off by default, so every earlier run is unchanged.
- Reference oracle: a tiny state model remembers the rooms, namespaces and keys a valid create made (`src/adapters/reference/seeded-state.ts`). The mutant `lookupFirst` is the order the original platform shows (look the object up, then validate): the unseeded held vectors fail under it and every probe passes, so a probe does not decide the order. The mutant `noPayloadValidation` fails every probe. A re-issued retired vector has its own mutant `bs:<rule key>`.
- Authority and seeds (O-05, D884): every seed step needs authority (`rooms/create` item 2, `git-ns/namespace/bind` item 1, `keys/create` item 2), so every probe requires `optional:authorised`. A `CP-SD` probe names the key the seed's response assigned (`$cap(keyid)`; `keys/create` returns "the assigned `keyId`"), not the id it asked for. A probe of a task that links `rooms/create` 0.3 (`rooms/records/prune` 0.2) seeds with 0.3. A seed that the deployment's policy still refuses keeps its `orRefusal` (R-01, test/fixes3.test.ts), and the later advisory steps then answer for a missing object.
- Re-issues: five retired vectors are re-issued under new ids (CB-RM-028 as a `CP-RM` vector, CB-SD-021, 023, 024 and 025 as `CP-SD` vectors); their tombstones stay retired. The other retired vectors stay retired for the reason on each: they need a presentation that verifies, a passkey gesture, a published criterion, a configured passkey origin, or an open challenge, none of which a signed Trust Task can create.

## Advisory FAILs of the community service

The community service in process (original VTI) fails advisory coverage vectors in the table below. Every one is covered by a recorded difference in [exceptions/exceptions.json](../exceptions/exceptions.json) (the platform differs from the text: class A) or by a recorded finding in [results/findings.json](../results/findings.json) (the answer is a platform order that the text leaves open: class C, and the FAIL stays a FAIL). None is a platform fault the suite has not looked at, and none is in a headline count. The seeded-state probe (above) is the evidence for the lookup-first findings: with a real room or namespace the platform answers `malformedRequest`, so the unseeded FAIL is a lookup before validation, an order SPEC.md 7.2 does not fix. The table carries no counts; `test/coverage-fail-ids.test.ts` checks that each id's cover is what the two files say, that every finding is listed, and (with `COVERAGE_RUNS_DIR` set to a directory of recorded runs) that every FAIL id of the community service in those runs is covered.

| Vector | Cover | Class | Cause |
|---|---|---|---|
| CP-CA-002 | finding | A | `owners` has `minItems` 1 and `uniqueItems`; duplicated owners are answered `git-ns:membersOnly` (the seeded probe of CX-CA-031, itself a recorded class A difference); a seeded probe, advisory, never promoted |
| CP-CA-003 | finding | A | an empty `owners` list is answered with a success response, duplicated owners with `git-ns:membersOnly` (the seeded probe of CX-CA-033, a recorded class A difference); advisory, never promoted |
| CB-RM-034 | finding | C | `noKeyHolder` answered before the storage-config check; the text does not order the two refusals |
| CV-RM-107 | finding | C | lookup before validation; the seeded probe CP-RM-001 answers `permissionDenied` only, so it shows the lookup, not the validation |
| CV-RM-110 | finding | C | lookup before validation (probe CP-RM-002) |
| CV-RM-113 | finding | C | lookup before validation (probe CP-RM-003) |
| CX-RM-004 | finding | C | lookup before validation (probe CP-RM-004) |
| CX-RM-005 | finding | C | upload lookup before validation; the task's own `notFound`; not seedable, no probe |
| CX-RM-009 | finding | C | lookup before validation (probe CP-RM-005) |
| CX-RM-010 | finding | C | lookup before validation (probe CP-RM-006) |
| CX-RM-034 | finding | C | lookup before validation (probe CP-RM-007) |
| CX-RM-035 | finding | C | lookup before validation (probe CP-RM-008) |
| CX-RM-036 | finding | C | lookup before validation (probe CP-RM-009) |
| CX-RM-037 | finding | C | lookup before validation; the seeded probe CP-RM-010 answers `permissionDenied` only, so it shows the lookup, not the validation |
| CX-RM-038 | finding | C | lookup before validation (probe CP-RM-011) |
| CX-RM-039 | finding | C | lookup before validation (probe CP-RM-012) |
| CX-MB-040 | exception | A | an unknown top-level member is accepted, then `internalError` |
| CX-CA-022 | finding | C | lookup before validation (probe CP-CA-001) |
| CX-CA-031 | exception | A | `uniqueItems` on `owners` not enforced (probe CP-CA-002); the empty-owners step is the lookup order |
| CX-CA-033 | exception | A | `minItems` and `uniqueItems` on `owners` not enforced (probe CP-CA-003, one step created a repository on the in-process host) |

## Skip classes

A SKIP of a coverage vector gets a class from [results/skip-classes.json](../results/skip-classes.json), first matching rule wins, and a rule may carry a coverage name (`label`):

| Name | Class | Meaning |
|---|---|---|
| not served by this surface | not applicable, or different version when another version of the task ran | The platform does not declare the type as served, so the check for a server of the task does not apply. Not applicable only where the run's cited not-offered rule has evidence (docs/04 section 8). |
| send-only | same | An emit surface sends the task and serves none; only the emit check applies. |
| no counterpart | not applicable | No implementation answers the task, so the receive check has no host. No recorded reason carries it yet. |
| not reached by the suite | not reached | The keyring-wallet surfaces: 21 emit vectors (rooms blobs, room keys file-key and present, room records, the rooms offer accept, ballot cast, join-request decide, contexts get, webvh did delete, relationship issue and propose, witness session and submit) are for types the wallet source builds but the suite adapter's emit flows do not drive. A limit of the suite, never not applicable. The same name covers four VTI emit vectors (CE-RM-001, 003, 006 and 023: rooms blobs chunk 0.1, blobs upload abort and commit 0.2, the community rooms offer accept 0.1) on the two VTI emit surfaces: VTI builds them only through the VTA's room action call, which the emit host cannot drive. |

`test/coverage-skip-classes.test.ts` proves the rules, and, when `COVERAGE_RUNS_DIR` names recorded coverage runs, that every distinct SKIP reason in them gets a class (none unclassified).

## Where to look

- results/coverage.md: the generated version-grain page.
- [vectors/coverage/not-generated.json](../vectors/coverage/not-generated.json): types left out and why.
- [decisions](decisions/03-vectors-and-coverage.md#coverage-families-trust-tasks-keyring-wallet-and-vti-use): CV-1 to CV-13.
- [23-spec-drift.md](23-spec-drift.md): drift hashes on every vector.

## What they do and do not show

They check mechanics: a platform checks a payload against the task's schema, enforces the policy the specification declares, and does not refuse a well-formed request for an envelope reason; and the documents a platform sends match the schema and policy. Where the task force's text states a rule, a behavioural vector checks it. They do not check what a task does or who may ask for it (governance is the deployment's choice).

Vectors built from the registry schema are not independent evidence of that schema, because the platforms build against the same schema. Vectors built from the task force's own invalid-payload examples rest on the task force's text instead, and say so.

Destructive tasks (wipe, delete, purge, restore, remove, revoke, reset, rotate) are probed with schema-invalid payloads only. No result is a statement of interoperability: the strongest claim is that both platforms ran with the same vectors.
