# Candidate task notes: the local text behind the candidate coverage vectors

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Ten task types that keyring-wallet or the VTI agent service (VTA) use have no Trust Tasks specification (`tf_status` `none` in the census, decision [CV-6](decisions/03-vectors-and-coverage.md#cv6)). A vector for such a type is written only where a local text exists, and it is channel `candidate`: advisory, never an endorsement, not in any headline total. This page is that local text. It quotes the implementation's own words, with a file and line range relative to the platform repository, so a reader can check each quote. Nothing here is invented: where the implementation does not say a thing, this page does not either.

All quotes are from `verifiable-trust-infrastructure` (the OpenVTC repository), release commit `26d0da81a1ae2df800ee6b9c1806bb3c3c7a9d2f` ("chore: release (#2411)"); a second checkout at a later commit holds the same lines in every file quoted below except `vta-service/src/trust_tasks/mod.rs` and `vta-sdk/src/trust_tasks.rs`, where only the line numbers differ. The vectors prove nothing about what the tasks mean; they check one mechanic only (see "What a candidate vector checks").

The page is pinned by digest by every candidate vector (`source.pinnedDigest`), so a change to it shows up as spec drift ([23-spec-drift.md](23-spec-drift.md)).

## What a candidate vector checks

One thing: a request document whose payload breaks the request shape the implementation itself declares (a required member missing, or a member of the wrong type) is refused, and nothing is done. No valid request is ever sent, so nothing is archived, restored, purged or changed. A refusal for lack of authority (`permissionDenied`) is accepted in place of `malformedRequest`, because in the vault handlers the capability gate runs before the payload is read (see below), and who may ask is the deployment's governance, not the suite's.

The suite's reference oracle serves each candidate type from a small suite-owned definition: the payload schema written out from the quoted request struct (`src/coverage/candidates.ts`) and the declared policy left at "nothing required", because the quoted text declares none. That definition exists so the vectors can be shown to fail against a mutant that skips payload validation; it is the suite's reading of the quotes, not a Trust Tasks schema.

## vault/archive, vault/unarchive, vault/restore, vault/purge (0.1)

The four types are dispatched but unspecified. The implementation lists them as such, with its own plan to generalise them:

Source: `vta-service/src/trust_tasks/mod.rs:305-310`

```
    // ─ Vault archival lifecycle (#540) — generalise with a store
    //   discriminator instead of publishing twelve (reduction plan §C).
    "https://trusttasks.org/spec/vault/archive/0.1",
    "https://trusttasks.org/spec/vault/unarchive/0.1",
    "https://trusttasks.org/spec/vault/restore/0.1",
    "https://trusttasks.org/spec/vault/purge/0.1",
```

What each does, in the implementation's words:

Source: `vta-sdk/src/trust_tasks.rs:675-694`

```
/// `spec/vault/archive/0.1` — soft-disable an entry: it is hidden from the
/// default `vault/list` and refused for use (release / proxy-login /
/// sign-trust-task) but fully restorable via [`TASK_VAULT_UNARCHIVE_0_1`].
/// Auth: VaultWrite. openvtc lifecycle extension (no upstream 0.2).
pub const TASK_VAULT_ARCHIVE_0_1: &str = "https://trusttasks.org/spec/vault/archive/0.1";

/// `spec/vault/unarchive/0.1` — return an `Archived` entry to `Active`.
/// Auth: VaultWrite. openvtc lifecycle extension.
pub const TASK_VAULT_UNARCHIVE_0_1: &str = "https://trusttasks.org/spec/vault/unarchive/0.1";

/// `spec/vault/restore/0.1` — undelete a soft-deleted (`Deleted`) entry back
/// to `Active`, allowed only while still inside the grace window. Auth:
/// VaultWrite. openvtc lifecycle extension.
pub const TASK_VAULT_RESTORE_0_1: &str = "https://trusttasks.org/spec/vault/restore/0.1";

/// `spec/vault/purge/0.1` — irreversibly hard-delete an entry (typically an
/// already-`Deleted` tombstone, but valid on any entry), skipping the grace
/// window. The secret bytes are zeroised on removal; no recovery. Auth:
/// VaultWrite. openvtc lifecycle extension.
pub const TASK_VAULT_PURGE_0_1: &str = "https://trusttasks.org/spec/vault/purge/0.1";
```

The request shape, one body for all four:

Source: `vta-service/src/trust_tasks/vault.rs:252-265`

```
/// Shared request body for the archival lifecycle verbs `vault/archive`,
/// `vault/unarchive`, `vault/restore`, and `vault/purge`. Each targets a
/// single entry by id, honours optimistic concurrency, and carries an
/// optional `reason` the dispatch spine lifts into the audit row's `detail`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultLifecycleBody {
    id: String,
    #[serde(default)]
    expected_version: Option<u32>,
    #[serde(default)]
    #[allow(dead_code)] // read generically by the spine for the audit `detail`
    reason: Option<String>,
}
```

Reading of the quote: `id` is a required string; `expectedVersion` (non-negative integer) and `reason` (string) are optional. The struct does not deny unknown members, so the vectors do not probe an unknown member. The wire member names are camelCase (`rename_all`).

The order in the handlers: the capability gate first, then the payload.

Source: `vta-service/src/trust_tasks/vault.rs:1359-1368` (archive, unarchive and restore share this function; `handle_purge` repeats the same two steps at `:1400-1407`)

```
async fn handle_lifecycle_transition(
    state: &AppState,
    auth: &AuthClaims,
    doc: TrustTask<Value>,
    verb: &str,
    transition: impl Fn(&mut VaultEntry, &str, Option<&str>) -> Result<(), LifecycleError>,
) -> TrustTaskOutcome {
    if let Err(r) = require_capability(state, auth, &doc, Capability::VaultWrite, verb).await {
        return r;
    }
```

The payload is then parsed with `parse_payload`, which returns a `MalformedRequest` rejection when the payload does not fit the struct (`vta-service/src/trust_tasks/helpers.rs:116-127`, not quoted in full). Hence the vectors accept `malformedRequest` or `permissionDenied`.

Quoted for completeness, the implementation's own error names for a missing entry (`vta-service/src/trust_tasks/vault.rs:479-483`): `vault/{verb}:notFound`. The vectors do not use it: it needs a valid request.

## vta/audit/update-retention (1.0)

Listed as unspecified, with a named candidate:

Source: `vta-service/src/trust_tasks/mod.rs:288-290`

```
    // ─ vta/audit retention pair — candidate `audit/retention/{show,update}`.
    "https://trusttasks.org/spec/vta/audit/get-retention/1.0",
    "https://trusttasks.org/spec/vta/audit/update-retention/1.0",
```

The request shape:

Source: `vta-sdk/src/protocols/audit_management/retention.rs:27-34`

```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateRetentionBody {
    /// Number of days to retain audit logs (minimum 1, maximum 365).
    #[serde(alias = "retention_days")]
    pub retention_days: u32,
}
```

Reading of the quote: `retentionDays` is a required non-negative integer. The comment gives a range of 1 to 365; the vectors do not send an in-range or an out-of-range value, only a document with the member missing and one with a string in its place. The handler parses the payload before it checks authority:

Source: `vta-service/src/trust_tasks/audit.rs:107-117`

```
/// Handler for `spec/vta/audit/update-retention/1.0`. Super-admin only.
pub(super) async fn handle_update_retention(
    state: &AppState,
    auth: &AuthClaims,
    doc: TrustTask<Value>,
) -> TrustTaskOutcome {
    let req: UpdateRetentionBody = match parse_payload(&doc) {
        Ok(r) => r,
        Err(resp) => return resp,
    };
    match operations::audit::update_retention(
```

## Candidate types with no refusal reachable from the text (no vector)

These have a local text but no vector, and are listed in the generated list of [docs/22](22-coverage-families.md#candidate-coverage-vectors-cc) as blocked on text:

- `vta/audit/get-retention/1.0` and `vta/seeds/list/1.0`: the request body is an empty struct (`GetRetentionBody {}` at `vta-sdk/src/protocols/audit_management/retention.rs:9`, `ListSeedsBody {}` at `vta-sdk/src/protocols/seed_management/list.rs:10`, "the operation takes no input parameters", `list.rs:4-6`). There is no required member to leave out, and the only request the text describes is a valid one, which decision [CV-5](decisions/03-vectors-and-coverage.md#cv5) leaves out for the administration families.
- `vta/seeds/rotate/1.0`: the request body has one optional member (`mnemonic: Option<String>`, `vta-sdk/src/protocols/seed_management/rotate.rs:5-8`), so there is no required member to leave out, and a valid request rotates the agent's seed. The handler doc states the task is super-admin only (`vta-service/src/trust_tasks/seeds.rs:3-7`). A wrong-type probe on the optional member is possible from the struct but is outside the rule "refusal of a document with a missing required member only" for a destructive task; left as an open question for the maintainer.
- `vetting/vetters/grant/0.1` (keyring-wallet): the wallet source mentions it only in comments about a credential a community delivers (`bifold/packages/trust-tasks/src/vetting/roleCard.ts:11`, `bifold/packages/core/src/modules/trust-tasks/module/vtiInbox.ts:150`, "tf vetting/vetters/grant/0.1 as recast by #691"). It does not state a request payload, a response or a refusal for the type, so there is no text to write a vector from. The VTI community service's own `vtc/vetting/vetters/grant/0.1` is a different, specified type.

## vrc/relationships/witness-share (0.1)

Its local text is [10-witness-share-profile.md](10-witness-share-profile.md). The 23 `WSH` vectors in `vectors/ceremony-vrc/witness-share.json` are already channel `candidate` and cite it; no new vector is written here. The census row is linked to them by the vector's `source.slug` and `source.version`, so the coverage page counts the type as having a vector.
