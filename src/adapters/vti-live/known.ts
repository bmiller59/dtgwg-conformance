// SPDX-License-Identifier: Apache-2.0
// The identities whose keys the suite itself holds: every harness actor, reference party and wallet stand-in derives its key from a one-byte
// seed (`seedOf(n)`). A live service has no bearer-minting shortcut, so a session for one of these DIDs is a real login with this key
// (class D: the key is the suite's, not the wallet's own). A DID outside the set cannot get a session or a membership through the harness.
import { didKeyFromEd25519, ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";

/** did -> signer for seeds 0..255, as a did:key and as the did:peer:0 form the wallet host mints (`did:peer:0` + the multibase of the same key). */
export function knownSigners(): Map<string, Ed25519Signer> {
  const m = new Map<string, Ed25519Signer>();
  for (let n = 0; n < 256; n++) {
    const s = ed25519Signer(seedOf(n));
    m.set(s.did, s);
    m.set(`did:peer:0${didKeyFromEd25519(s.publicKey).slice("did:key:".length)}`, s);
  }
  return m;
}
