// SPDX-License-Identifier: Apache-2.0
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)]! + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("invalid base58 character");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  for (const ch of text) {
    if (ch !== "1") break;
    zeros++;
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...bytes]);
}

/** base58btc multibase ("z" prefix). */
export function toMultibase(bytes: Uint8Array): string {
  return "z" + base58Encode(bytes);
}

export function fromMultibase(text: string): Uint8Array {
  if (!text.startsWith("z")) throw new Error("not base58btc multibase");
  return base58Decode(text.slice(1));
}
