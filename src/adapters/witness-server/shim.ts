// SPDX-License-Identifier: Apache-2.0
// keyring-wallet witness-server adapter: the parts that do not touch the server's code (constants, capabilities, small helpers). The host
// (witness-host.jest.ts) runs inside the witness server's own jest setup and wraps its real trust-task code; everything here is plain
// TypeScript so it is unit-tested with the suite's own runner (test/witness-server.test.ts).
//
// The row this adapter produces is "keyring-wallet witness server: logic over a shim carrier". The server's witness/session and
// witness/session/submit handlers, the credential it issues and the document proofs are the server's own; the DIDComm framing below
// `handleDocument` is replaced by an in-memory capture, so nothing here says anything about the real wire.
import type { AcceptanceWindow, Capabilities } from "../../adapter/contract.ts";

export const WITNESS_ADAPTER_NAME = "keyring-wallet-witness-server";
/** The row of a run against a build that serves the 0.2 pair: kept apart from the two 0.1 rows. */
export const WITNESS_LATEST_NAME = "keyring-wallet-witness-server-latest";
export const ROW_LABEL = "logic over a shim carrier";

/**
 * The Type URIs of the witness pair and of discovery. The server matches Type URIs by exact string and a build serves the versions it lists (the
 * host reads them from the server module's own `SESSION_TYPES`, `SUBMIT_TYPES` and `DISCOVERY_TYPES`; a build that exports none serves 0.1 only).
 * The latest are session 0.2, submit 0.2 and discovery 0.4 (decision D290); 0.1 is the older, non-focus version.
 */
export const SESSION_TYPE = "https://trusttasks.org/spec/witness/session/0.2";
export const SUBMIT_TYPE = "https://trusttasks.org/spec/witness/session/submit/0.2";
export const DISCOVERY_TYPE = "https://trusttasks.org/spec/trust-task-discovery/0.4";
export const SESSION_TYPE_01 = "https://trusttasks.org/spec/witness/session/0.1";
export const SUBMIT_TYPE_01 = "https://trusttasks.org/spec/witness/session/submit/0.1";
export const DISCOVERY_TYPE_01 = "https://trusttasks.org/spec/trust-task-discovery/0.1";
/** What a server build with no exported version lists (the build before the 0.2 pair): 0.1 only. */
export const LEGACY_SERVED: ServedTypes = { session: [SESSION_TYPE_01], submit: [SUBMIT_TYPE_01], discovery: [DISCOVERY_TYPE_01] };
export interface ServedTypes { session: string[]; submit: string[]; discovery: string[] }
/** True for a `#response` of the witness pair at any version (the host counts handled sessions and issued credentials by it). */
export const isSessionResponse = (type: string): boolean => /^https:\/\/trusttasks\.org\/spec\/witness\/session\/\d+\.\d+#response$/.test(type);
export const isSubmitResponse = (type: string): boolean => /^https:\/\/trusttasks\.org\/spec\/witness\/session\/submit\/\d+\.\d+#response$/.test(type);

/** Key seeds of the harness actors the host imports into its wallet (the same bytes as `makeActors` in src/runner/engine.ts), so a presentation can be signed for them. */
export const ACTOR_SEEDS: Record<string, number> = { A: 0x0a, X: 0x0b, R: 0x0c, S: 0x0d, Q: 0x0e, W: 0x0f };
/** The witness's own connection key (the IUT's `vid`). */
export const WITNESS_SEED = 0x4c;
/** The key behind the credential issuer DID (a did:peer, as the server makes its own). */
export const ISSUER_SEED = 0x4d;
/** The domain the witness issues with its challenge (the server derives it from its port; the host fixes it). */
export const WITNESS_DOMAIN = "witness-session-conformance";

export interface WitnessBuild {
  /** Short commit of the witness-server package's repository (the bifold submodule) and of that submodule; "unknown" when unreadable. */
  commit: string;
  bifoldCommit: string;
  /** Trust Tasks locality policy: the server's default is `offered`. */
  policy: "off" | "offered" | "required";
  /** The credential wire shape: the server's default is `vsc`. */
  shape: "wd02" | "vsc";
  /** A run against a latest-versions build (WIT_ROW=latest): its own row name. */
  latest?: boolean;
  /** The Type URIs the server build serves (default: 0.1 only, the build before the 0.2 pair). */
  served?: ServedTypes;
}

/**
 * The witness keeps no acceptance window of its own beyond the wallet's five-minute clock allowance (`witnessConsumeChecks`: no maximum age,
 * no duplicate record, a freshness floor that refuses only a future-dated document). Only the skew is a number it has.
 */
export const WITNESS_WINDOW: Partial<AcceptanceWindow> = { clockSkewSeconds: 300 };

export function capabilities(b: WitnessBuild): Capabilities {
  return {
    name: b.latest === true ? WITNESS_LATEST_NAME : WITNESS_ADAPTER_NAME,
    implementation: b.latest === true ? WITNESS_LATEST_NAME : WITNESS_ADAPTER_NAME,
    version: `witness-server ${b.commit} (bifold ${b.bifoldCommit}; locality ${b.policy}, credential shape ${b.shape})`,
    tierMax: 1,
    bindings: ["in-process"],
    supportedTypes: [...(b.served ?? LEGACY_SERVED).session, ...(b.served ?? LEGACY_SERVED).submit, ...(b.served ?? LEGACY_SERVED).discovery],
    // The witness hosts no generic carrier task: the carrier-based vectors (framework, ceremony, VRC groups) are SKIP for it.
    carriers: [],
    cryptosuites: ["eddsa-jcs-2022"],
    // `authorised` (S-01): the witness vectors assert a session response, and a witness may decline by policy (`witness/session:refused`); this server accepts the harness actors' sessions (the recorded runs pass them)
    optional: ["clock", "transportIdentity", "witness.presentation", "authorised"],
    window: { maxAgeSeconds: 300, clockSkewSeconds: 300, expiryHorizonSeconds: 2592000, ...WITNESS_WINDOW },
    pins: { framework: "0.6.0", error: "0.6", binding: "none" },
  };
}

/** The states `observe documentState` reports (the reference vocabulary). */
export function stateFromReply(type: string | undefined): string {
  if (type === undefined) return "accepted";
  if (type.includes("/trust-task-error/")) return "errored";
  return "responded";
}

/** `member`: the memberPresentation of witness/session/submit 0.2: a presentation by a member DID (the `holder`) carrying a credential that names the member DID, bound to {challenge, domain}. */
export type VpVariant = "valid" | "wrongChallenge" | "wrongDomain" | "outsiderHolder" | "noCredential" | "unsigned" | "tamperedCredential" | "member";
const VARIANTS: readonly string[] = ["valid", "wrongChallenge", "wrongDomain", "outsiderHolder", "noCredential", "unsigned", "tamperedCredential", "member"];
export function vpVariantOf(v: unknown): VpVariant {
  if (v === undefined) return "valid";
  if (typeof v === "string" && VARIANTS.includes(v)) return v as VpVariant;
  throw new Error(`unknown presentation variant ${String(v)}`);
}
