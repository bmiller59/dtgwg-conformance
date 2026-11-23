// SPDX-License-Identifier: Apache-2.0
// Vector id scheme: <GROUP>-<NNN>, GROUP = upper-case letters/digits, optionally hyphenated
// (VRC-ISS-014, ENV-003). The numeric part is three or more digits. Ids are unique across the suite.
export const VECTOR_ID = /^([A-Z0-9][A-Z0-9]*(?:-[A-Z0-9][A-Z0-9]*)*)-(\d{3,})$/;
export const GROUP_ID = /^[A-Z0-9][A-Z0-9]*(?:-[A-Z0-9][A-Z0-9]*)*$/;

export function parseVectorId(id: string): { group: string; number: number } | null {
  const m = VECTOR_ID.exec(id);
  return m === null ? null : { group: m[1]!, number: Number(m[2]) };
}

export function formatVectorId(group: string, n: number): string {
  return `${group}-${String(n).padStart(3, "0")}`;
}
