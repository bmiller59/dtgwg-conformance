// SPDX-License-Identifier: Apache-2.0
// Pure helpers of the keyring-wallet-vta-wire adapter (no wallet or Credo imports, so they are unit-tested in this repository).

/** `did:webvh:<scid>:<host>[%3A<port>][:path]` to its https-or-http `did.jsonl` URL (http only for a loopback host). */
export function webvhLogUrl(did: string): string {
  const parts = did.split(":");
  const host = decodeURIComponent(parts[3] ?? "");
  const path = parts.slice(4).map(decodeURIComponent).join("/");
  const loop = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${loop ? "http" : "https"}://${host}/${path === "" ? ".well-known" : path}/did.jsonl`;
}

/** The decoded protected header of a JWE (algorithms and key ids only; never the ciphertext). */
export function jweSummary(raw: unknown): Record<string, unknown> {
  try {
    const jwe = typeof raw === "string" ? JSON.parse(raw) : raw;
    const header = JSON.parse(Buffer.from(jwe.protected, "base64url").toString("utf8"));
    return { alg: header.alg, enc: header.enc, typ: header.typ, skid: header.skid, apu: header.apu === undefined ? undefined : "present", recipients: (jwe.recipients ?? []).length, bytes: JSON.stringify(jwe).length };
  } catch {
    return { unparsed: true };
  }
}

/** Plain summary of a wire trace (JSON lines): counts by direction and the sequence of DIDComm types, for a run record. */
export function summariseTrace(lines: any[]): { frames: { out: number; in: number }; packed: string[]; unpacked: string[]; algs: string[] } {
  const algs = new Set<string>();
  const short = (t?: string) => (t === undefined ? "?" : t.replace(/^https:\/\/(didcomm\.org|trusttasks\.org\/binding\/didcomm|affinidi\.com\/atm)\//, ""));
  const packed: string[] = [];
  const unpacked: string[] = [];
  let out = 0;
  let inn = 0;
  for (const l of lines) {
    if (l.jwe?.alg !== undefined) algs.add(`${l.jwe.alg}/${l.jwe.enc}`);
    if (l.dir === "ws->") out++;
    if (l.dir === "ws<-") inn++;
    if (l.dir === "pack") packed.push(short(l.plaintext?.type));
    if (l.dir === "unpack") unpacked.push(short(l.plaintext?.type));
  }
  return { frames: { out, in: inn }, packed, unpacked, algs: [...algs].sort() };
}
