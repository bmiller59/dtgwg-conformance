// SPDX-License-Identifier: Apache-2.0
// The one-time hand-off of the VTC's setup did:key at the VTA (what the kit's `vtc:up` does), through the suite's operator over REST, so it needs no kit
// client of the right release: creates the VTC's context and grants the setup DID an admin entry scoped to it with the hand-off marker (VTI-ACL-054).
//   node --experimental-strip-types stack/vtc-grant.ts <setup did:key>     (env as the wire row: KW_WIRE_VTA_URL, KW_WIRE_VTA_DID, KW_WIRE_ADMIN_FILE)
import { operatorFromEnv } from "../host-control.ts";

const did = process.argv[2];
if (did === undefined || !did.startsWith("did:key:")) { console.error("usage: vtc-grant.ts <setup did:key>"); process.exit(2); }
const ctx = process.env.VTC_CONTEXT ?? "vtc";
const op = operatorFromEnv();
const tolerate = async (f: () => Promise<unknown>): Promise<boolean> => { try { await f(); return true; } catch (e) { if (/already|exists|conflict/i.test(String((e as Error).message))) return false; throw e; } };
console.log((await tolerate(() => op.call("vta/contexts/create/1.0", { id: ctx, name: "VTC" }))) ? `created context ${ctx}` : `context ${ctx} exists`);
const expiresAt = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
console.log((await tolerate(() => op.call("acl/grant/0.2", { entry: { subject: did, role: "admin", act: { scope: "contexts", contexts: [ctx] }, keys: { scope: "all" }, capabilities: { scope: "ceiling" }, label: `${ctx} setup`, expiresAt, ext: { "org.openvtc.handoff": true } }, reason: "VTC setup hand-off" }))) ? `granted the hand-off to ${did}` : "setup DID already granted");
