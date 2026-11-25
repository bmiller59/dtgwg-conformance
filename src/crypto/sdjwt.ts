// SPDX-License-Identifier: Apache-2.0
// A minimal SD-JWT-VC presentation (IETF SD-JWT, EdDSA over Ed25519 did:key) for the credential-exchange/present 0.2 vectors: an
// issuer-signed JWT whose claims are selectively disclosable, the disclosures, and a key-binding JWT that carries the verifier's nonce
// (`nonce`) and audience (`aud`) and the digest of what it binds (`sd_hash`). Only what the vectors need: one hash algorithm (sha-256),
// top-level claims, the holder key named by `cnf.kid`.
import { createHash, verify as nodeVerify } from "node:crypto";
import { type Ed25519Signer, ed25519FromDidKey, ed25519PublicKeyObject } from "./didkey.ts";

const b64 = (b: Uint8Array | string): string => (typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b)).toString("base64url");
const json64 = (v: unknown): string => b64(JSON.stringify(v));
const sha = (s: string): string => b64(createHash("sha256").update(s).digest());
const jws = (header: Record<string, unknown>, payload: Record<string, unknown>, signer: Ed25519Signer): string => {
  const input = `${json64(header)}.${json64(payload)}`;
  return `${input}.${b64(signer.sign(new TextEncoder().encode(input)))}`;
};

export interface SdJwtSpec {
  issuer: Ed25519Signer;
  holder: Ed25519Signer;
  /** Selectively disclosable claims; every one is disclosed. */
  claims: Record<string, unknown>;
  vct: string;
  nonce: string;
  audience: string;
  /** `iat` of both JWTs, whole seconds. */
  iatSec: number;
}

/** `<issuer-signed JWT>~<disclosure>~...~<key-binding JWT>` */
export function buildSdJwtPresentation(s: SdJwtSpec): string {
  const disclosures = Object.entries(s.claims).map(([k, v], i) => json64([`salt-${i}-${k}`, k, v]));
  const payload = { iss: s.issuer.did, vct: s.vct, iat: s.iatSec, _sd_alg: "sha-256", _sd: disclosures.map(sha).sort(), cnf: { kid: s.holder.verificationMethod } };
  const issued = `${jws({ alg: "EdDSA", typ: "dc+sd-jwt", kid: s.issuer.verificationMethod }, payload, s.issuer)}~${disclosures.map((d) => `${d}~`).join("")}`;
  return issued + jws({ alg: "EdDSA", typ: "kb+jwt" }, { nonce: s.nonce, aud: s.audience, iat: s.iatSec, sd_hash: sha(issued) }, s.holder);
}

export interface SdJwtVerdict {
  valid: boolean;
  reason?: string;
  /** The issuer's DID (`iss`), the holder key (`cnf.kid`), the key-binding JWT's `nonce` and `aud`, and the disclosed claims. */
  issuer?: string;
  holder?: string;
  nonce?: unknown;
  audience?: unknown;
  claims?: Record<string, unknown>;
}

const parse = (jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown>; input: string; sig: Buffer } | undefined => {
  const parts = jwt.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as unknown;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    if (typeof header !== "object" || header === null || typeof payload !== "object" || payload === null) return undefined;
    return { header: header as Record<string, unknown>, payload: payload as Record<string, unknown>, input: `${parts[0]}.${parts[1]}`, sig: Buffer.from(parts[2]!, "base64url") };
  } catch {
    return undefined;
  }
};

const verifies = (j: NonNullable<ReturnType<typeof parse>>, kid: unknown): boolean => {
  if (j.header.alg !== "EdDSA" || typeof kid !== "string") return false;
  const key = ed25519FromDidKey(kid);
  return key !== null && nodeVerify(null, Buffer.from(j.input), ed25519PublicKeyObject(key), j.sig);
};

/** Verifies the issuer signature, every disclosure against `_sd`, and the key-binding JWT (holder key, `sd_hash`); the caller checks nonce and audience. */
export function verifySdJwtPresentation(token: string): SdJwtVerdict {
  const cut = token.lastIndexOf("~");
  if (cut < 0) return { valid: false, reason: "no key-binding JWT" };
  const parts = token.slice(0, cut).split("~");
  const issuerJwt = parse(parts[0] ?? "");
  const kb = parse(token.slice(cut + 1));
  if (issuerJwt === undefined || kb === undefined) return { valid: false, reason: "not a compact SD-JWT with a key-binding JWT" };
  const kid = issuerJwt.header.kid;
  if (typeof kid !== "string" || kid.split("#", 1)[0] !== issuerJwt.payload.iss || !verifies(issuerJwt, kid)) return { valid: false, reason: "the issuer signature does not verify" };
  const sd = Array.isArray(issuerJwt.payload._sd) ? issuerJwt.payload._sd : [];
  const claims: Record<string, unknown> = {};
  for (const d of parts.slice(1)) {
    if (!sd.includes(sha(d))) return { valid: false, reason: "a disclosure is not in _sd" };
    try {
      const [, k, v] = JSON.parse(Buffer.from(d, "base64url").toString("utf8")) as [string, string, unknown];
      claims[k] = v;
    } catch {
      return { valid: false, reason: "a disclosure does not decode" };
    }
  }
  const cnf = issuerJwt.payload.cnf as { kid?: unknown } | undefined;
  if (kb.header.typ !== "kb+jwt" || !verifies(kb, cnf?.kid)) return { valid: false, reason: "the key-binding JWT does not verify" };
  if (kb.payload.sd_hash !== sha(token.slice(0, cut + 1))) return { valid: false, reason: "sd_hash does not bind the presentation" };
  return { valid: true, issuer: String(issuerJwt.payload.iss), holder: String(cnf?.kid).split("#", 1)[0], nonce: kb.payload.nonce, audience: kb.payload.aud, claims };
}
