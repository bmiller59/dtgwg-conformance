// SPDX-License-Identifier: Apache-2.0
// The phone-side reading a persona scenario observes (docs/31), pure and shared by the reference phone and the keyring-wallet host (which runs under jest, so this file imports nothing).
type Doc = Record<string, unknown>;
/** The phone's reading (shared with the wallet host): the answer to the mint, `{minted:{did, serverless?}}`. */
export function personaStoredKind(st: { minted?: Doc }, kind: string): number {
  const m = st.minted;
  if (kind === "persona:did-method:webvh") return typeof m?.did === "string" && m.did.startsWith("did:webvh:") ? 1 : 0;
  if (kind === "persona:serverless:true") return m?.serverless === true ? 1 : 0;
  if (kind === "persona:minted") return m === undefined ? 0 : 1;
  throw new Error(`the phone does not answer stored ${kind}`);
}
