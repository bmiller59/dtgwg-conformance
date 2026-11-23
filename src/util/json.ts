// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from "@openvtc/trust-tasks/runtime";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const enc = new TextEncoder();
export const dec = new TextDecoder("utf-8", { fatal: false });

/** RFC 8785 canonical form as UTF-8 bytes. */
export function jcsBytes(value: unknown): Uint8Array {
  return enc.encode(canonicalJson(value));
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Whole-second RFC 3339 UTC timestamp for an epoch-millisecond instant (rounded down). */
export function isoSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}
