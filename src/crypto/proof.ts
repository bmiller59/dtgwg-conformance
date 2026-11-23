// SPDX-License-Identifier: Apache-2.0
// Data Integrity proofs for Trust Task documents, eddsa-jcs-2022 over did:key (Ed25519) only.
// Written for this suite on node:crypto so the suite needs no cryptography dependency. The
// verifier mirrors the rules of the task force's proof fixtures (fixtures/proof): ranges on
// `created`/`expires`, purpose handling, issuer binding, @context equality, and Ed25519
// strictness (small-order and non-canonical keys refused, cofactorless equation).
import { createHash, verify as nodeVerify } from "node:crypto";
import { fromMultibase, toMultibase } from "./base58.ts";
import { ed25519FromDidKey, ed25519PublicKeyObject, type Ed25519Signer } from "./didkey.ts";

/** A verification key resolved from a DID document, with the verification relationships that list it. */
export interface ResolvedKey {
  publicKey: Uint8Array;
  purposes: string[];
}
export type KeyResolver = (verificationMethod: string) => ResolvedKey | null;

const RELATIONSHIPS = ["authentication", "assertionMethod", "capabilityInvocation", "capabilityDelegation"];

/**
 * A resolver over a DID document (the `didDocument` that `provision` returns for the IUT): Ed25519 keys given as
 * `publicKeyMultibase` (multicodec ed25519-pub, 0xed 0x01) or as an OKP/Ed25519 `publicKeyJwk`, with the purposes
 * taken from the relationship arrays that reference the method (by full id, relative id, or embedded).
 */
export function resolverFromDidDocument(document: unknown): KeyResolver {
  const doc = isObject(document) ? document : {};
  const did = typeof doc.id === "string" ? doc.id : "";
  const absolute = (id: string): string => (id.startsWith("#") ? `${did}${id}` : id);
  const methods = new Map<string, Record<string, unknown>>();
  const add = (m: unknown): void => {
    if (isObject(m) && typeof m.id === "string") methods.set(absolute(m.id), m);
  };
  if (Array.isArray(doc.verificationMethod)) doc.verificationMethod.forEach(add);
  const purposes = new Map<string, string[]>();
  for (const rel of RELATIONSHIPS) {
    const list = doc[rel];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const id = typeof entry === "string" ? absolute(entry) : isObject(entry) && typeof entry.id === "string" ? absolute(entry.id) : undefined;
      if (id === undefined) continue;
      if (isObject(entry)) add(entry);
      purposes.set(id, [...(purposes.get(id) ?? []), rel]);
    }
  }
  return (vm) => {
    const m = methods.get(vm);
    if (m === undefined) return null;
    let key: Uint8Array | undefined;
    try {
      if (typeof m.publicKeyMultibase === "string") {
        const raw = fromMultibase(m.publicKeyMultibase);
        if (raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01) key = raw.subarray(2);
      } else if (isObject(m.publicKeyJwk) && m.publicKeyJwk.kty === "OKP" && m.publicKeyJwk.crv === "Ed25519" && typeof m.publicKeyJwk.x === "string") {
        key = new Uint8Array(Buffer.from(m.publicKeyJwk.x, "base64url"));
      }
    } catch {
      return null;
    }
    return key === undefined || key.length !== 32 ? null : { publicKey: key, purposes: purposes.get(vm) ?? [] };
  };
}
import { isObject, jcsBytes } from "../util/json.ts";

export const SIGNING_PURPOSES: readonly string[] = [
  "authentication",
  "assertionMethod",
  "capabilityInvocation",
  "capabilityDelegation",
];

export type ProofFailure =
  | "malformedProof"
  | "issuerMismatch"
  | "unsupportedCryptosuite"
  | "signatureInvalid";

export interface ProofVerdict {
  valid: boolean;
  failure?: ProofFailure;
  detail?: string;
  /** The `proofPurpose` that was verified, when the proof was well-formed enough to read it. */
  purpose?: string;
  signer?: string;
}

const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());

function hashData(config: unknown, body: unknown): Uint8Array {
  return new Uint8Array([...sha256(jcsBytes(config)), ...sha256(jcsBytes(body))]);
}

export interface SignOptions {
  purpose?: string;
  /** Epoch ms for `proof.created` (written in whole seconds). */
  created: number;
  /** Test use: sign although the document issuer is not the signer (verification method controller mismatch). */
  allowIssuerMismatch?: boolean;
  /** Proof members `challenge` and `domain` (presentations). */
  challenge?: string;
  domain?: string;
  /** Member naming the signing party: `issuer` (default) or `holder` (a presentation). */
  controllerMember?: "issuer" | "holder" | "publisher";
}

export function signDocument<T extends Record<string, unknown>>(
  doc: T,
  signer: Ed25519Signer,
  options: SignOptions,
): T & { proof: Record<string, unknown> } {
  const { proof: _drop, ...body } = doc as Record<string, unknown>;
  const member = options.controllerMember ?? "issuer";
  if (body[member] !== signer.did && options.allowIssuerMismatch !== true) throw new Error(`document ${member} is not the signer`);
  const purpose = options.purpose ?? "authentication";
  const config: Record<string, unknown> = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: new Date(Math.floor(options.created / 1000) * 1000).toISOString().replace(".000Z", "Z"),
    verificationMethod: signer.verificationMethod,
    proofPurpose: purpose,
  };
  if (options.challenge !== undefined) config.challenge = options.challenge;
  if (options.domain !== undefined) config.domain = options.domain;
  if (Object.prototype.hasOwnProperty.call(body, "@context")) {
    config["@context"] = structuredClone(body["@context"]);
  }
  const proofValue = toMultibase(signer.sign(hashData(config, body)));
  return { ...(body as T), proof: { ...config, proofValue } };
}

const PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** RFC 3339 date-time (Z or numeric offset) to epoch ms, every field range-checked; else undefined. */
export function parseDateTimeStamp(value: string): number | undefined {
  const m = PARTS.exec(value);
  if (m === null) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number, number, number, number, number, number,
  ];
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > dim || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  let offsetMinutes = 0;
  if (m[8] !== undefined) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return undefined;
    offsetMinutes = (m[8] === "+" ? 1 : -1) * (oh * 60 + om);
  }
  const fractionMs = m[7] === undefined ? 0 : Number(`0${m[7]}`) * 1000;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, 0);
  return utc.getTime() + fractionMs - offsetMinutes * 60_000;
}

const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
// y-coordinates of the small-order points (orders 1, 2, 4, 8) of edwards25519.
const SMALL_ORDER_Y = new Set<bigint>([
  0n,
  1n,
  P - 1n,
  0x26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05n,
  0x7a03ac9277fdc74ec6cc392cfa53202a0f67100d760b3cba4fd84d3d706a17c7n,
]);

function leToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
}

/** RFC 8032 strictness for the public key and S; the equation itself is OpenSSL's (cofactorless). */
function ed25519VerifyStrict(sig: Uint8Array, message: Uint8Array, pub: Uint8Array): boolean {
  if (sig.length !== 64 || pub.length !== 32) return false;
  const y = leToBigInt(pub) & ((1n << 255n) - 1n);
  if (y >= P || SMALL_ORDER_Y.has(y)) return false;
  if (leToBigInt(sig.subarray(32)) >= L) return false;
  try {
    return nodeVerify(null, message, ed25519PublicKeyObject(pub), sig);
  } catch {
    return false;
  }
}

export interface VerifyOptions {
  nowMs: number;
  skewMs?: number;
  /** Member naming the signing party: `issuer` (default) or `holder` (a presentation). */
  controllerMember?: "issuer" | "holder" | "publisher";
  /** Resolves verification methods that are not did:key (a DID document the implementation provisioned). */
  resolve?: KeyResolver;
}

function fail(failure: ProofFailure, detail: string, extra: Partial<ProofVerdict> = {}): ProofVerdict {
  return { valid: false, failure, detail, ...extra };
}

export function verifyDocumentProof(doc: unknown, opts: VerifyOptions): ProofVerdict {
  if (!isObject(doc)) return fail("malformedProof", "document is not an object");
  const proof = doc.proof;
  if (!isObject(proof)) return fail("malformedProof", "no proof object");
  if (proof.type !== "DataIntegrityProof") return fail("malformedProof", "proof type");
  for (const k of ["cryptosuite", "verificationMethod", "proofPurpose", "proofValue"]) {
    if (typeof proof[k] !== "string" || proof[k] === "") return fail("malformedProof", `proof.${k}`);
  }
  const purpose = proof.proofPurpose as string;
  if (!SIGNING_PURPOSES.includes(purpose)) return fail("malformedProof", "proofPurpose names no signing relationship");
  if (proof.cryptosuite !== "eddsa-jcs-2022") return fail("unsupportedCryptosuite", String(proof.cryptosuite));
  const skew = opts.skewMs ?? 60_000;
  if (proof.created !== undefined) {
    const at = typeof proof.created === "string" ? parseDateTimeStamp(proof.created) : undefined;
    if (at === undefined) return fail("malformedProof", "proof.created");
    if (at > opts.nowMs + Math.max(0, skew)) return fail("malformedProof", "proof.created in the future");
  }
  if (proof.expires !== undefined) {
    const at = typeof proof.expires === "string" ? parseDateTimeStamp(proof.expires) : undefined;
    if (at === undefined) return fail("malformedProof", "proof.expires");
    if (opts.nowMs > at) return fail("malformedProof", "proof.expires has passed");
  }
  const issuer = doc[opts.controllerMember ?? "issuer"];
  if (typeof issuer !== "string") return fail("issuerMismatch", "no in-band issuer");
  const vm = proof.verificationMethod as string;
  if (vm.split("#", 1)[0] !== issuer) return fail("issuerMismatch", "verificationMethod controller differs from issuer");
  if (Object.prototype.hasOwnProperty.call(proof, "@context")) {
    if (!Object.prototype.hasOwnProperty.call(doc, "@context")) return fail("malformedProof", "proof @context without document @context");
    const a = Buffer.from(jcsBytes(proof["@context"]));
    const b = Buffer.from(jcsBytes(doc["@context"]));
    if (!a.equals(b)) return fail("malformedProof", "@context differs");
  }
  let pub = ed25519FromDidKey(vm);
  if (pub === null && opts.resolve !== undefined) {
    const k = opts.resolve(vm);
    if (k !== null) {
      if (!k.purposes.includes(purpose)) return fail("signatureInvalid", `verification method is not listed under ${purpose}`, { purpose });
      pub = k.publicKey;
    }
  }
  if (pub === null) return fail("signatureInvalid", "unsupported verification method");
  let sig: Uint8Array;
  try {
    sig = fromMultibase(proof.proofValue as string);
  } catch {
    return fail("signatureInvalid", "proofValue encoding");
  }
  const { proofValue: _pv, ...config } = proof;
  const { proof: _p, ...body } = doc;
  const ok = ed25519VerifyStrict(sig, hashData(config, body), pub);
  return ok ? { valid: true, purpose, signer: issuer } : fail("signatureInvalid", "signature does not verify", { purpose });
}
