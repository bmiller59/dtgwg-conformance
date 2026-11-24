// SPDX-License-Identifier: Apache-2.0
// Every exception entry carries a class from the allowed set (A differs from spec text, B the vector reads more than the text says,
// C the text is open, D adapter or stand-in artefact; docs/03-glossary.md) and a reason that cites the specification text or a vector.
// Entries that did not meet this when the check was added are listed below as a baseline: they are classed or cited only with evidence
// and the owner's review, never in bulk. The baseline may only shrink: a new offender fails, and so does a listed entry that has been fixed
// (remove it from the list).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";
import { EXCEPTION_CLASSES } from "../src/vectors/types.ts";

interface Entry { impl: string; vector: string; class?: string; reason: string }
const entries = (JSON.parse(readFileSync(join(SUITE_ROOT, "exceptions/exceptions.json"), "utf8")) as { exceptions: Entry[] }).exceptions;
const key = (e: Entry): string => `${e.impl} ${e.vector}`;

/** A citation of specification text (SPEC.md, a task's spec.md, a section or item, a schema) or of a vector id. */
export const CITES = /SPEC\.md|spec\.md|specs\/|\b[A-Z]{2,5}(-[A-Z]{2,5})?-\d{3}\b|section \d|§|item \d|the (task|specification|framework) (text|says)|docs\/\d\d|schema/;

const UNCLASSED_BASELINE = [
  "keyring-wallet DUP-006", "keyring-wallet TD-001", "keyring-wallet TD-002", "keyring-wallet TD-003", "keyring-wallet TD-004", "keyring-wallet TD-005", "keyring-wallet TD-006",
  "keyring-wallet WSH-001", "keyring-wallet WSH-002", "keyring-wallet WSH-003", "keyring-wallet WSH-004", "keyring-wallet WSH-005", "keyring-wallet WSH-006", "keyring-wallet WSH-007",
  "keyring-wallet WSH-008", "keyring-wallet WSH-009", "keyring-wallet WSH-010", "keyring-wallet WSH-011", "keyring-wallet WSH-012", "keyring-wallet WSH-018", "keyring-wallet WSH-025",
  "verifiable-trust-infrastructure-inprocess PRF-008", "verifiable-trust-infrastructure-inprocess PRF-019", "verifiable-trust-infrastructure-vtc-inprocess PRF-008",
  "verifiable-trust-infrastructure-vtc-inprocess PRF-019", "witness-server WSS-010",
];
const UNCITED_BASELINE = [
  "keyring-wallet DUP-101", "keyring-wallet DUP-102", "keyring-wallet DUP-104", "keyring-wallet DUP-105", "keyring-wallet DUP-106", "keyring-wallet DUP-107", "keyring-wallet DUP-108",
  "keyring-wallet DUP-109", "verifiable-trust-infrastructure-inprocess CEX-010", "verifiable-trust-infrastructure-inprocess CEX-022", "verifiable-trust-infrastructure-inprocess PRF-008",
  "verifiable-trust-infrastructure-inprocess PRF-010", "verifiable-trust-infrastructure-inprocess PRF-011", "verifiable-trust-infrastructure-inprocess PRF-019",
  "verifiable-trust-infrastructure-inprocess PRF-029", "verifiable-trust-infrastructure-inprocess PRF-103", "verifiable-trust-infrastructure-vtc-inprocess PRF-008",
  "verifiable-trust-infrastructure-vtc-inprocess PRF-010", "verifiable-trust-infrastructure-vtc-inprocess PRF-011", "verifiable-trust-infrastructure-vtc-inprocess PRF-019",
  "verifiable-trust-infrastructure-vtc-inprocess PRF-029", "witness-server WSD-004", "witness-server WSS-005",
];

describe("exception entries: class and citation", () => {
  test("every class is one of the allowed set", () => {
    for (const e of entries) if (e.class !== undefined) assert.ok((EXCEPTION_CLASSES as readonly string[]).includes(e.class), `${key(e)}: class ${e.class}`);
  });
  test("every entry has a class, except the baselined ones (the baseline only shrinks)", () => {
    const unclassed = entries.filter((e) => e.class === undefined).map(key).sort();
    assert.deepEqual(unclassed.filter((k) => !UNCLASSED_BASELINE.includes(k)), [], "new entries without a class");
    assert.deepEqual(UNCLASSED_BASELINE.filter((k) => !unclassed.includes(k)), [], "baselined entries now classed or gone: remove them from UNCLASSED_BASELINE");
  });
  test("every reason cites specification text or a vector, except the baselined ones (the baseline only shrinks)", () => {
    const uncited = entries.filter((e) => !CITES.test(e.reason)).map(key).sort();
    assert.deepEqual(uncited.filter((k) => !UNCITED_BASELINE.includes(k)), [], "new entries whose reason cites no spec text or vector");
    assert.deepEqual(UNCITED_BASELINE.filter((k) => !uncited.includes(k)), [], "baselined entries now cite: remove them from UNCITED_BASELINE");
  });
});
