// SPDX-License-Identifier: Apache-2.0
// The voter-side reading a ballot-cast scenario observes (docs/32), pure and shared by the reference voter and the keyring-wallet host (which runs under jest, so this file imports nothing).
/** The voter's reading of its latest cast: the outcome of the receipt it kept, or the refusal it saw (by local code). */
export interface CastState { outcome?: string; leaf?: number; firstLeaf?: number; refused?: string; receipts?: number }
export function ballotStoredKind(st: CastState, kind: string): number {
  if (kind.startsWith("cast:outcome:")) return st.outcome === kind.slice(13) ? 1 : 0;
  if (kind.startsWith("cast:refused:")) return st.refused === kind.slice(13) ? 1 : 0;
  // `cast:leaf:<n>`: the latest receipt's leafIndex counted from the first receipt the voter kept (the board index also counts the lifecycle entries a box appends before any cast, which the cast task does not fix, so an absolute index is not a requirement).
  if (kind.startsWith("cast:leaf:")) return st.leaf !== undefined && st.leaf - (st.firstLeaf ?? st.leaf) === Number(kind.slice(10)) ? 1 : 0;
  if (kind === "cast:receipts") return st.receipts ?? 0;
  throw new Error(`the voter does not answer stored ${kind}`);
}
