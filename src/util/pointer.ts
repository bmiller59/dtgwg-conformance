// SPDX-License-Identifier: Apache-2.0
// Minimal RFC 6901 JSON pointer helpers over plain JSON values.

export function parsePointer(ptr: string): string[] {
  if (ptr === "") return [];
  if (!ptr.startsWith("/")) throw new Error(`bad JSON pointer: ${ptr}`);
  return ptr
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function getPointer(root: unknown, ptr: string): unknown {
  let cur: unknown = root;
  for (const seg of parsePointer(ptr)) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (cur !== null && typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

function parentOf(root: unknown, segs: string[]): Record<string, unknown> | unknown[] {
  let cur: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)?.[seg];
  }
  if (cur === null || typeof cur !== "object") throw new Error("pointer parent is not a container");
  return cur as Record<string, unknown> | unknown[];
}

export function setPointer(root: unknown, ptr: string, value: unknown): void {
  const segs = parsePointer(ptr);
  if (segs.length === 0) throw new Error("cannot replace the document root");
  const parent = parentOf(root, segs);
  const last = segs[segs.length - 1]!;
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else parent[last] = value;
}

export function removePointer(root: unknown, ptr: string): void {
  const segs = parsePointer(ptr);
  if (segs.length === 0) throw new Error("cannot remove the document root");
  const parent = parentOf(root, segs);
  const last = segs[segs.length - 1]!;
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
}
