// SPDX-License-Identifier: Apache-2.0
// Offline ACL seeding of the harness actors in a VTC started from the buildathon kit (docs: the adapter header, adapter.ts).
// Why: the VTC's door charges a document from a signer it holds no ACL entry for to a per-address budget of 10 documents, then one
// every 5 seconds (vtc-service/src/routing/trust_task_admission.rs). A signer with a live ACL entry is charged its own, larger bucket.
// Seeding the six harness did:keys as plain `member` entries (no administrative authority) lets a full run finish in minutes; the
// entries confer nothing the carrier needs. Unsigned and tampered documents are still charged to the address budget, and the
// adapter waits that out (HTTP 429, Retry-After).
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";

export const HARNESS_ROLES = ["A", "X", "R", "S", "Q", "W"] as const;
const SEEDS: Record<string, number> = { A: 0x0a, X: 0x0b, R: 0x0c, S: 0x0d, Q: 0x0e, W: 0x0f };

export function harnessDids(): { role: string; did: string }[] {
  return HARNESS_ROLES.map((role) => ({ role, did: ed25519Signer(seedOf(SEEDS[role]!)).did }));
}

export interface SeedStep { cmd: string; args: string[] }

/**
 * The commands, in order, to seed the actors: stop the daemon (the offline `acl add` needs the store lock), add each entry with a
 * one-off container over the same data volume, start the daemon. `acl add` on an entry that already exists is reported as such, so
 * the sequence can be repeated.
 */
export function seedSteps(opts: { service?: string; profile?: string; config?: string } = {}): SeedStep[] {
  const service = opts.service ?? "vtc";
  const profile = opts.profile ?? "vtc";
  const config = opts.config ?? "/var/lib/vtc/config.toml";
  const dc = (...a: string[]): SeedStep => ({ cmd: "docker", args: ["compose", "--profile", profile, ...a] });
  return [
    dc("stop", service),
    ...harnessDids().map(({ role, did }) => dc("run", "--rm", "--no-deps", "--entrypoint", "vtc", service, "--config", config, "acl", "add", "--did", did, "--role", "member", "--label", `ttc-harness-${role}`)),
    dc("start", service),
  ];
}
