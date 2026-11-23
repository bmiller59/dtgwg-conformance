// SPDX-License-Identifier: Apache-2.0
// The member-side reading a directory scenario observes (docs/31), pure and shared by the reference member and the keyring-wallet host (which runs under jest, so this file imports nothing).
/**
 * What the member's side of a directory scenario can observe, as a count (1 or 0, or a number): the state is the last reading each kind of call left
 * `{card:{revision,name,missing}, fieldKeys, rows:[{entryId,name}], seen:[keys], seenName, none, lookup, conflict, refused}`. Shared by the oracle member and the wallet host.
 */
export function dirStoredKind(st: Record<string, unknown>, kind: string): number {
  const card = st.card as { revision?: number; name?: string; missing?: string[] } | undefined;
  const rows = (st.rows as { name?: string }[] | undefined) ?? [];
  const seen = (st.seen as string[] | undefined) ?? [];
  const b = (x: boolean): number => (x ? 1 : 0);
  if (kind.startsWith("dir-my:revision:")) return b(card?.revision === Number(kind.slice(16)));
  if (kind.startsWith("dir-my:missing:")) return b(card?.missing?.includes(kind.slice(15)) === true);
  if (kind === "dir-my:missing-none") return b(card !== undefined && (card.missing ?? []).length === 0);
  if (kind.startsWith("dir-my:name:")) return b(card?.name === kind.slice(12));
  if (kind.startsWith("dir-fields:")) return b(((st.fieldKeys as string[] | undefined) ?? []).includes(kind.slice(11)));
  if (kind.startsWith("dir-members:has-name:")) return b(rows.some((r) => r.name === kind.slice(21)));
  if (kind.startsWith("dir-members:rows:")) return b(rows.length === Number(kind.slice(17)));
  if (kind.startsWith("dir-seen:line:")) return b(seen.includes(kind.slice(14)));
  if (kind.startsWith("dir-seen:name:")) return b(st.seenName === kind.slice(14));
  if (kind === "dir-seen:none") return b(st.none === true);
  if (kind.startsWith("dir-lookup:")) return b((kind.slice(11) === "none" ? undefined : kind.slice(11)) === st.lookup);
  if (kind === "dir-conflict") return b(st.conflict === true);
  if (kind.startsWith("dir-refused:")) return b(st.refused === kind.slice(12));
  throw new Error(`the member does not answer stored ${kind}`);
}
