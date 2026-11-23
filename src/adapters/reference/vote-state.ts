// SPDX-License-Identifier: Apache-2.0
// The member-side reading an elections scenario observes (docs/31), pure and shared by the reference member and the keyring-wallet host (which runs under jest, so this file imports nothing).
/** The member's reading, `{polls, refused, version}`: shared with the wallet host (pure). */
export function voteStoredKind(st: { polls?: number; refused?: string; version?: string }, kind: string): number {
  if (kind.startsWith("vote:polls:")) return st.polls === Number(kind.slice(11)) ? 1 : 0;
  if (kind.startsWith("vote:refused:")) return st.refused === kind.slice(13) ? 1 : 0;
  if (kind.startsWith("vote:version:")) return st.version === kind.slice(13) ? 1 : 0;
  throw new Error(`the member does not answer stored ${kind}`);
}
