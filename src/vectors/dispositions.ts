// SPDX-License-Identifier: Apache-2.0
// The dispositions a step expects, by polarity (shared by the completeness measure and the effect derivation).
export const POSITIVE_DISPOSITIONS: ReadonlySet<string> = new Set(["response", "answered", "emitted", "next-step"]);
export const NEGATIVE_DISPOSITIONS: ReadonlySet<string> = new Set(["error", "any-refusal", "silence", "duplicate"]);
