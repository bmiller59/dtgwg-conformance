// SPDX-License-Identifier: Apache-2.0
// Capabilities of the two ceremony participants of the keyring-wallet-vta-wire row (pure; unit-tested here, no wallet imports).
//
//   K  the wallet (the member's phone, the admin manager of the agent): its own VtaClient over a real DIDComm v2 wire. It `initiate`s the wallet's
//      calls (the wallet builds, signs, packs, sends and reads the answer itself) and reports what it sent and received.
//   V  the live VTA container (the agent): observed and configured through an operator identity over REST (the harness stand-in for an
//      operator console, class D); a document that a vector or a replay step hands it travels over the same wire, as the wallet's identity.
//
// Both say plainly that they run in the `wire` mode: documents cross a real mediator, not a runner relay.
import type { Capabilities } from "../../adapter/contract.ts";
import { KVC_KINDS } from "../vti-inprocess/consent.ts";

export const WIRE_ROW = "wire";
export const WIRE_MODE = "wire: real DIDComm v2 (authcrypt, forward, messagepickup 3.0) through a live mediator to a live VTA container";
export const K_NAME = "keyring-wallet-vta-wire";
export const V_NAME = "vti-vta-wire";
export const C_NAME = "vti-vtc-wire";

/** The ceremony groups whose scenarios map to this row (the wallet as admin manager, step-up caller and vault client of its agent). */
export const WIRE_GROUPS = ["FC-ACL", "FC-VLT", "FC-STU"] as const;
/** The community ceremonies (wire row, part 4): the wallet as the applicant and member, the live VTC as the community. */
export const COMMUNITY_GROUPS = ["FC-MBR", "FC-IDV"] as const;
/** FC-KVC (task-consent): the wallet is the approver, the live VTA the executor (wire row, part 3). */
export const KVC_APPROVER_ROLES = ["approver"] as const;

export interface WireInfo {
  walletCommit: string;
  vtaImage: string;
  mediatorImage: string;
  resolver: "shim" | "real";
  /** The task types the live VTA lists in `trust-task-discovery` (read over the wire). */
  vtaTypes: string[];
}

const PINS = { framework: "0.6.0", error: "0.6", binding: "didcomm/0.2" };

export function kCapabilities(info: Pick<WireInfo, "walletCommit" | "resolver"> & { kinds: string[] }): Capabilities {
  return {
    name: K_NAME,
    implementation: "keyring-wallet",
    platform: "keyring-wallet",
    version: `keyring-wallet ${info.walletCommit}, ${WIRE_ROW} row (resolver ${info.resolver})`,
    tierMax: 1,
    bindings: ["didcomm", "didcomm-v2"],
    supportedTypes: [],
    carriers: [],
    cryptosuites: ["eddsa-jcs-2022"],
    optional: ["clockFree", "initiate", "peer.connect", "observe.ceremony", "observe.received", "transportIdentity", "trigger.consentEnrol"],
    initiates: [...new Set([...info.kinds, "consent-decision"])],
    ceremonyRoles: [...WIRE_GROUPS.map((ceremony) => ({ ceremony, roles: ["member-phone"] })), { ceremony: "FC-KVC", roles: [...KVC_APPROVER_ROLES] }, ...COMMUNITY_GROUPS.map((ceremony) => ({ ceremony, roles: ["member-phone"] }))],
    mode: WIRE_MODE,
    pins: PINS,
  };
}

export function vCapabilities(info: WireInfo): Capabilities {
  return {
    name: V_NAME,
    implementation: "verifiable-trust-infrastructure",
    platform: "verifiable-trust-infrastructure",
    version: `${info.vtaImage} behind ${info.mediatorImage}, ${WIRE_ROW} row`,
    tierMax: 1,
    bindings: ["didcomm", "didcomm-v2"],
    supportedTypes: info.vtaTypes,
    carriers: [],
    cryptosuites: ["eddsa-jcs-2022"],
    // No `clock`: a document's age is the wallet's clock and the mediator's, which the harness cannot move (the wire has real time).
    optional: ["clockFree", "initiate", "peer.connect", "observe.ceremony", "observe.received", "transportIdentity", "trigger.requireStepUp", "trigger.consentSetup"],
    initiates: [...KVC_KINDS],
    ceremonyRoles: [...WIRE_GROUPS.map((ceremony) => ({ ceremony, roles: ["agent"] })), { ceremony: "FC-KVC", roles: ["executor"] }],
    mode: WIRE_MODE,
    pins: PINS,
  };
}

/** Scenario steps this row cannot carry, and why (reported as not reached, never as a failure of either platform). */
export const NOT_REACHED: Record<string, string> = {
  "FC-ACL-008": "the wallet's clock cannot be moved on a real wire: the mediator and the VTA check the same moved time (a faked Date breaks the login), so a stale document cannot be signed here",
};

/** The live VTC as the community of the community ceremonies (what it serves is what its `trust-task-discovery` lists, read as its operator). */
export function communityCapabilities(info: WireInfo & { vtcImage?: string }): Capabilities {
  return {
    ...vCapabilities(info),
    name: C_NAME,
    version: `${info.vtcImage ?? "vtc"} behind ${info.mediatorImage}, ${WIRE_ROW} row`,
    optional: ["clockFree", "peer.connect", "observe.received", "transportIdentity"],
    initiates: [],
    ceremonyRoles: COMMUNITY_GROUPS.map((ceremony) => ({ ceremony, roles: ["community"] })),
  };
}
