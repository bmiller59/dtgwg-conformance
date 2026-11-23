// SPDX-License-Identifier: Apache-2.0
import { put } from "./helpers.ts";

/** Two ceremony rows as the driver writes them: one scenario with the wallet as approver, one with a reference party only. */
export function ceremonyRecordsFixture(root: string): void {
  put(root, "ceremonies/kvc.a/FC-KVC-001/scenario-result.json", JSON.stringify({ format: "tt-ceremony-scenario-result/0.1", countedAsConformance: false, results: [{ id: "FC-KVC-001", status: "completed", participants: { E: { adapter: "verifiable-trust-infrastructure-inprocess" }, K1: { adapter: "keyring-wallet" } } }] }));
  put(root, "ceremonies/rms.up/agent/scenario-result.json", JSON.stringify({ format: "tt-ceremony-scenario-result/0.1", countedAsConformance: false, results: [{ id: "FC-RMS-001", status: "ended-as-specified", participants: { M: { adapter: "reference-party" } } }] }));
  put(root, "ceremonies/kvc.a/driver.log", "not a record");
}
