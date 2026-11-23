# 20. Observing pushed documents (optional capability `observe.pushed`)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Contract change B of the 2L coverage review ([proposals/2l-profiles-draft.md](proposals/2l-profiles-draft.md) sections 9.6 and 9.8; roadmap decision RD7 in [16](16-roadmap-and-decisions.md) and [decisions](decisions/05-application-profiles-roadmap.md#roadmap-decisions-rd1-to-rd7)). Additive: nothing existing changes and an adapter that does not declare the capability is unaffected.

## 1. The problem

Some tasks have no reply document, and the answer to them is the next task the implementation sends to the counterparty. In credential-exchange an `offer` (issuer to holder) is answered by the holder's `request`, a `request` by the issuer's `issue`, and a deferred `query` by the holder's `present`. The adapter's `send` returns only replies to the sender, so these answers were unobservable: the vectors could assert "nothing is stored" but not "the right task went to the right party on the right thread".

## 2. The mechanism

Three additive pieces, all optional.

1. **Capability.** `observe.pushed` in `Capabilities.optional`. Declare it only if every document the implementation pushes is recorded, otherwise a negative vector ("nothing pushed") would pass vacuously.
2. **Observe query.** `observe {query: "pushed", to?: vid, type?: typeUri, threadId?: string}` returns `{value: <count>, documents: [<document text>, ...]}`, oldest first. `ObserveResult.documents` is new and optional; `value` stays a count. Every filter given must match; none given matches everything. `to` is the document's `recipient`; `threadId` is its `threadId`, or its own `id` when it has none (a document that opens a thread). Documents are returned exactly as sent.
3. **Vector step.** `observePushed` (docs/04 section 3.0; `ObservePushedSpec` in `src/vectors/types.ts`, validated in `validate.ts`, in the JSON schema). The engine (`pushedErrors` in `src/runner/engine.ts`) queries with the step's filter, requires the document to be issued by the implementation, applies the optional `pointer`/`match` assertions, and polls for up to `withinMs` real milliseconds. On failure it lists what was pushed instead, so a wrong thread or recipient is visible in the report.

A separate method was considered and rejected: `observe` already carries every other state query through the existing JSON-RPC and client/server plumbing (`dispatch`, `RpcAdapter`, example server), so the shape needs no change there; stdio and HTTP adapters carry it unchanged.

## 3. Correlation by thread id

A pushed answer belongs to the exchange by its thread, not by its recipient alone. The vectors therefore name the thread the answer must be on: the offer's thread (the offer's `threadId`, or its `id` when it opens one), the request's thread, the query's original thread. CEX-039 sends two offers and requires each to be answered on its own thread. The mutants `pushedWrongThread` (a fresh thread), `pushedWrongRecipient` (another party) and `pushedWrongType` (a different task) must each fail the positive vectors.

## 4. How an adapter implements it

An adapter that can see the implementation's transport or outbox records each document it sends on its own initiative:

```ts
import { PushedBox } from "../../adapter/pushed.ts";
const outbox = new PushedBox();                 // clear() it in reset()
outbox.record(documentText, recipientVid);      // where the implementation hands the document to its transport; `to` defaults to `recipient`
// observe():
if (q.query === "pushed") return outbox.observe(q);   // { value, documents }
// capabilities(): optional: [..., "observe.pushed"]
```

`PushedBox` (`src/adapter/pushed.ts`) is the whole helper: `record(doc, to?)`, `query(filter)`, `observe(filter)`, `clear()`. An implementation that keeps a durable outbox table (VTI's pending signed documents, a wallet's DIDComm outbox) can answer from its rows with the same filter and skip the class. The adapter observes; it must not cause the push (the vector drives the implementation with `send` or a `trigger` helper, then observes).

Inbox side: an implementation that is the recipient of a push, rather than the sender, can be observed the other way round by an adapter that stands in as the counterparty (a loopback endpoint that records what arrives); that is the same `observe` answer from a different source (docs/proposals/upstream-harness-asks.md).

When the implementation can only be driven to push through a human or operator act, the adapter offers a `trigger` helper for it (the reference offers `makeOffer`, and `queryDecision` already exists); the vector `requires` it, and is SKIP without it.

## 5. SKIP when undeclared

A vector with an `observePushed` step `requires` `optional:observe.pushed`. An adapter that does not declare it gets SKIP with "missing capability optional:observe.pushed", never PASS and never FAIL, and an implementation that does not offer the behaviour can say so through `notOffered`. The engine also refuses to run the step on an adapter that does not declare it.

## 6. Vectors (`vectors/dtg/cex-push.json`, group CEX, registry channel)

| ID | Asserts | Class | Mutants |
|---|---|---|---|
| CEX-033 | accepted offer: `request` pushed to the issuer on the offer's thread | CLARIFY | noPush, pushedWrongThread, pushedWrongRecipient, pushedWrongType |
| CEX-034 | refused offer: no `request` pushed | CLARIFY | pushOnRefusal |
| CEX-035 | request on an offered thread: `issue` pushed to the holder on that thread, issued by the implementation | CLARIFY | the four above |
| CEX-036 | request for no offer: refused, no `issue` pushed | Tier 1 | pushOnRefusal |
| CEX-037 | approved deferred query: `present` pushed on the query's thread with the query's nonce and the verifier as audience | CLARIFY | the four above |
| CEX-038 | declined deferred query: nothing pushed | Tier 1 | pushOnDecline |
| CEX-039 | two offers, two threads: each answered on its own | CLARIFY | the four above |

## 7. Draft-status caveats

- The kit specs `credential-exchange/offer`, `request` and `present` 0.1 are status `draft` (`targetFrameworkVersion` 0.5.0), as every registry spec is. The channel is `registry` as for CEX-001 to CEX-032, each vector carries the spec digest pin and a note.
- What the specs state: the holder replies on the offer's thread with `request` (offer spec lines 59-61, request spec line 72); the issuer answers a request on-thread with `issue` (request spec line 74); a deferred query is presented on the original thread once approval lands (present spec line 77, query spec). What they do not state: that the reply is automatic or immediate. A holder may decline, an issuer's human may review first, and a deferral may wait. The positive vectors are therefore CLARIFY (reported as observed, never gating); the negatives that follow from a stated refusal or a stated condition (no offer, declined) are Tier 1.
- The reference does not mint a real OID4VCI key-binding proof, so the `request` it pushes carries a structural stand-in, and the `issue` it pushes binds the credential subject to the request's sender. The vectors assert neither. A real implementation must bind to the key in the proof (request spec, "Two bindings, not one").
- The pushed-document check is the suite's reading of "reply on-thread"; it does not claim the specs require pushing rather than replying on the carrier, which depends on the binding in use.

A negative check (`none`) waits at least the run's minimum quiet period (docs/04 section 3.3: 1500 ms over DIDComm, 0 over a synchronous binding) even when the vector gives a shorter `withinMs`, because a push can still be in flight over an asynchronous binding (O-13, D887).
