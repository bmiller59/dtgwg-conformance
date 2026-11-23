// SPDX-License-Identifier: Apache-2.0
// The member-side reading a rooms scenario observes (docs/32), pure and shared by the reference member and the keyring-wallet host (which runs under jest, so this file imports nothing).
export interface RoomsReading {
  offers?: number; offerState?: string; offerCreds?: boolean; offersVersion?: string;
  memberships?: string[]; accepted?: string; putKey?: string; putVersion?: number; refused?: string; upload?: string;
  keys?: number; keysVersion?: string; keyPackage?: boolean; acted?: boolean; actVersion?: string;
}
/** `rooms:*` kinds: offers:<n>, offer-state:<s>, offer-creds, offers-version:<v>, membership:<state>, accepted:<state>, put:ok, refused:<code tail>, upload:ok, keys:<n>, keys-version:<v>, keypackage:ok, acted:ok, act-version:<v>. */
export function roomsStoredKind(st: RoomsReading, kind: string): number {
  const k = kind.startsWith("rooms:") ? kind.slice(6) : kind;
  if (k.startsWith("offers:")) return st.offers === Number(k.slice(7)) ? 1 : 0;
  if (k.startsWith("offer-state:")) return st.offerState === k.slice(12) ? 1 : 0;
  if (k === "offer-creds") return st.offerCreds === true ? 1 : 0;
  if (k.startsWith("offers-version:")) return st.offersVersion === k.slice(15) ? 1 : 0;
  if (k.startsWith("membership:")) return (st.memberships ?? []).filter((s) => s === k.slice(11)).length;
  if (k.startsWith("accepted:")) return st.accepted === k.slice(9) ? 1 : 0;
  if (k === "put:ok") return st.putVersion !== undefined && st.putVersion >= 1 ? 1 : 0;
  if (k.startsWith("refused:")) return st.refused === k.slice(8) ? 1 : 0;
  if (k === "upload:ok") return st.upload !== undefined ? 1 : 0;
  if (k.startsWith("keys:")) return st.keys === Number(k.slice(5)) ? 1 : 0;
  if (k.startsWith("keys-version:")) return st.keysVersion === k.slice(13) ? 1 : 0;
  if (k === "keypackage:ok") return st.keyPackage === true ? 1 : 0;
  if (k === "acted:ok") return st.acted === true ? 1 : 0;
  if (k.startsWith("act-version:")) return st.actVersion === k.slice(12) ? 1 : 0;
  throw new Error(`the member does not answer stored ${kind}`);
}
/** The blob manifest a member builds for a deterministic ciphertext of `size` bytes: sha-256 digests in multibase base58btc multihash form (`rooms/blobs/upload/begin/0.2`, BlobManifest). Pure: the caller passes the hash and encoder. */
export function blobManifest(size: number, chunkSize: number, sha256: (b: Uint8Array) => Uint8Array, b58: (b: Uint8Array) => string): { size: number; chunks: { chunkSize: number; chunkCount: number; chunkDigests: string[] }; digest: string } {
  const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff);
  const mh = (b: Uint8Array): string => `z${b58(new Uint8Array([0x12, 0x20, ...sha256(b)]))}`;
  const chunkDigests: string[] = [];
  for (let at = 0; at < size; at += chunkSize) chunkDigests.push(mh(bytes.slice(at, Math.min(size, at + chunkSize))));
  return { size, chunks: { chunkSize, chunkCount: chunkDigests.length, chunkDigests }, digest: mh(bytes) };
}
