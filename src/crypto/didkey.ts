// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey, createPublicKey, sign as nodeSign, type KeyObject } from "node:crypto";
import { fromMultibase, toMultibase } from "./base58.ts";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface Ed25519Signer {
  did: string;
  verificationMethod: string;
  publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
}

export function didKeyFromEd25519(publicKey: Uint8Array): string {
  return "did:key:" + toMultibase(new Uint8Array([0xed, 0x01, ...publicKey]));
}

/** Parse an Ed25519 did:key (with or without fragment). Other key types return null. */
export function ed25519FromDidKey(didOrVm: string): Uint8Array | null {
  const did = didOrVm.split("#", 1)[0]!;
  if (!did.startsWith("did:key:z")) return null;
  try {
    const raw = fromMultibase(did.slice("did:key:".length));
    if (raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01) return raw.slice(2);
  } catch {
    /* not decodable */
  }
  return null;
}

export function ed25519Signer(seed: Uint8Array): Ed25519Signer {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const key: KeyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = key.export({ format: "jwk" }) as { x: string };
  const publicKey = new Uint8Array(Buffer.from(jwk.x, "base64url"));
  const did = didKeyFromEd25519(publicKey);
  const fragment = did.slice("did:key:".length);
  return {
    did,
    verificationMethod: `${did}#${fragment}`,
    publicKey,
    sign: (m) => new Uint8Array(nodeSign(null, m, key)),
  };
}

export function ed25519PublicKeyObject(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
}

/** Deterministic seed `[b; 32]`, as the task force's proof fixtures use `[7; 32]`. */
export function seedOf(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
