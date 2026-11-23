// SPDX-License-Identifier: Apache-2.0
// Digest of a JSON value in the framework's DigestMultibase form: multibase base58btc ("z") of a
// sha2-256 multihash (0x12 0x20 + 32 bytes) over the RFC 8785 canonical form of the value.
import { createHash } from "node:crypto";
import { toMultibase } from "./base58.ts";
import { jcsBytes } from "../util/json.ts";

export function digestMultibase(value: unknown): string {
  const sum = createHash("sha256").update(jcsBytes(value)).digest();
  return toMultibase(new Uint8Array([0x12, 0x20, ...sum]));
}
