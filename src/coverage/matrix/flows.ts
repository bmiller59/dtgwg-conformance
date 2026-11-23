// SPDX-License-Identifier: Apache-2.0
// Multi-step flows that keyring-wallet and VTI run together. Each lists the source files that implement it; the tasks of a flow are
// read from the Type URIs those files name, so the list cannot drift from the code. Paths are relative to each platform's checkout.

export interface FlowDef {
  platform: "kw" | "vti";
  id: string;
  title: string;
  files: string[];
  /** Vector or ceremony-scenario groups that exercise the whole flow end to end (not just single tasks). FC-* scenarios are reference-only dry runs (docs/25), not platform conformance. */
  e2eGroups: string[];
  notes: string;
}

const KW = "bifold/packages/core/src/modules/trust-tasks";
export const FLOWS: FlowDef[] = [
  { platform: "vti", id: "vti:agent-ceremony", title: "VTI agent ceremony handlers", files: ["vta-service/src/trust_tasks/ceremony.rs"], e2eGroups: [], notes: "Ceremony enactment on the agent (VTA)." },
  { platform: "vti", id: "vti:community-ceremony", title: "VTI community ceremony handlers", files: ["vtc-service/src/ceremony/execute.rs", "vtc-service/src/ceremony/admission.rs"], e2eGroups: [], notes: "Ceremony enactment on the community service (VTC)." },
  { platform: "vti", id: "vti:join", title: "VTI community join (manifest, submit, decide, member credential)", files: ["vtc-service/src/trust_tasks/admission_tasks.rs", "vtc-service/src/trust_tasks/member_tasks.rs"], e2eGroups: ["FC-ONB"], notes: "Matches the member-onboarding ceremony definition." },
  { platform: "vti", id: "vti:vetting", title: "VTI vetting", files: ["vtc-service/src/vetting/mod.rs"], e2eGroups: ["FC-VET"], notes: "" },
  { platform: "vti", id: "vti:step-up", title: "VTI step-up approval", files: ["vtc-service/src/trust_tasks/step_up_approver_tasks.rs", "vtc-service/src/trust_tasks/step_up_passkey_tasks.rs"], e2eGroups: [], notes: "" },
  { platform: "vti", id: "vti:oob-sign-in", title: "VTI out-of-band sign-in", files: ["vtc-service/src/trust_tasks/oob_tasks.rs"], e2eGroups: [], notes: "" },
  { platform: "vti", id: "vti:elections", title: "VTI elections", files: ["vtc-service/src/trust_tasks/election_tasks.rs"], e2eGroups: [], notes: "" },
  { platform: "vti", id: "vti:process-attestation", title: "VTI process attestation (PCS)", files: ["vta-service/src/trust_tasks/pcs.rs"], e2eGroups: [], notes: "" },
  { platform: "vti", id: "vti:credential-exchange", title: "VTI credential exchange (query, offer, request, present)", files: ["vta-service/src/trust_tasks/credential_exchange.rs", "vtc-service/src/trust_tasks/credential_exchange.rs"], e2eGroups: ["FC-CEX"], notes: "The CEX vectors run the single tasks; FC-CEX is the end-to-end scenario." },
  { platform: "kw", id: "kw:relationship", title: "KW relationship credential exchange (propose, issue, witness-share)", files: [`${KW}/ceremony.ts`, `${KW}/witnessShareSpec.ts`], e2eGroups: ["2PC", "VRC", "FC-VRC", "FC-WSH"], notes: "The suite's two-phase, VRC and FC scenario groups are the end-to-end layer." },
  { platform: "kw", id: "kw:shared-connect", title: "KW shared-connect", files: [`${KW}/module/sharedConnectCeremony.ts`, `${KW}/module/sharedConnectInviterCeremony.ts`], e2eGroups: [], notes: "Its `ceremony/shared-connect` label names no published ceremony definition; the tasks it carries are the relationship ones." },
  { platform: "kw", id: "kw:join", title: "KW community join", files: [`${KW}/module/joinWire.ts`, `${KW}/module/joinSubmission.ts`, `${KW}/module/joinManifest.ts`], e2eGroups: [], notes: "" },
  { platform: "kw", id: "kw:oob-sign-in", title: "KW out-of-band sign-in", files: [`${KW}/module/oobSignIn.ts`, `${KW}/module/oobSignInAgent.ts`], e2eGroups: [], notes: "" },
  { platform: "kw", id: "kw:step-up", title: "KW step-up approval", files: [`${KW}/module/stepUp.ts`], e2eGroups: [], notes: "" },
  { platform: "kw", id: "kw:vetting", title: "KW vetting", files: [`${KW}/module/vtiVetting.ts`, `${KW}/module/hiddenVetterRounds.ts`], e2eGroups: ["FC-VET"], notes: "" },
  { platform: "kw", id: "kw:process-attestation", title: "KW process attestation (PCS)", files: [`${KW}/module/pcsChallenge.ts`, `${KW}/module/pcsVetterTasks.ts`, `${KW}/module/pcsVtaPayloads.ts`], e2eGroups: [], notes: "" },
  { platform: "kw", id: "kw:provision", title: "KW provisioning to an agent (claim, redeem)", files: [`${KW}/module/vtaClaim.ts`], e2eGroups: [], notes: "" },
  { platform: "kw", id: "kw:devices", title: "KW device registration and wake", files: [`${KW}/module/vtaDevices.ts`], e2eGroups: [], notes: "" },
];
