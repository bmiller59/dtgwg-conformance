// SPDX-License-Identifier: Apache-2.0
// Step digest of `trust-ceremony-receipt` 0.1 (specs/trust-ceremony-receipt/0.1/spec.md:93-111):
//   digestMultibase = multibase( multihash( H( JCS(document) || salt ) ) )
// over the complete step document INCLUDING its `proof`, with the enactment salt (decoded from its multibase form) as a SUFFIX. This is
// not the task digest of SPEC.md 4.9.3, which leaves the top-level proof out (`src/crypto/digest.ts`).
import { createHash } from "node:crypto";
import { fromMultibase, toMultibase } from "./base58.ts";
import { jcsBytes } from "../util/json.ts";

/** Multihash function codes the suite knows: sha2-256 (0x12, 32 bytes) and sha2-512 (0x13, 64 bytes). */
export const MULTIHASH = { "sha2-256": { code: 0x12, node: "sha256", length: 32 }, "sha2-512": { code: 0x13, node: "sha512", length: 64 } } as const;
export type HashName = keyof typeof MULTIHASH;

/** Decode the salt text (multibase base58btc). */
export function saltBytes(salt: string): Uint8Array {
  return fromMultibase(salt);
}

/** Variants a vector or a mutant uses to build a wrong digest on purpose. The default is the specified computation. */
export interface DigestVariant {
  hash?: HashName;
  /** `prefix` puts the salt before the document (spec.md:109 says suffix). */
  saltAt?: "suffix" | "prefix";
  /** Leave the top-level `proof` out, as the task digest does (spec.md:103). */
  withoutProof?: boolean;
}

export function stepDigest(document: Record<string, unknown>, salt: string, variant: DigestVariant = {}): string {
  const hash = MULTIHASH[variant.hash ?? "sha2-256"];
  let doc = document;
  if (variant.withoutProof === true) {
    const { proof: _p, ...rest } = document;
    doc = rest;
  }
  const message = jcsBytes(doc);
  const s = saltBytes(salt);
  const input = variant.saltAt === "prefix" ? Buffer.concat([s, message]) : Buffer.concat([message, s]);
  const sum = createHash(hash.node).update(input).digest();
  return toMultibase(new Uint8Array([hash.code, hash.length, ...sum]));
}

/** Split a DigestMultibase (base58btc `z` or base64url `u`) into its multihash function code and digest bytes; undefined when it is not a multihash. */
export function parseDigest(text: string): { code: number; digest: Uint8Array } | undefined {
  let raw: Uint8Array;
  try {
    if (text.startsWith("z")) raw = fromMultibase(text);
    else if (text.startsWith("u")) raw = new Uint8Array(Buffer.from(text.slice(1), "base64url"));
    else return undefined;
  } catch {
    return undefined;
  }
  if (raw.length < 2 || raw[1] !== raw.length - 2) return undefined;
  return { code: raw[0]!, digest: raw.subarray(2) };
}

/** Whether two DigestMultibase values name the same multihash, compared on decoded bytes (spelling-independent). */
export function sameDigest(a: string, b: string): boolean {
  const x = parseDigest(a);
  const y = parseDigest(b);
  return x !== undefined && y !== undefined && x.code === y.code && Buffer.from(x.digest).equals(Buffer.from(y.digest));
}
