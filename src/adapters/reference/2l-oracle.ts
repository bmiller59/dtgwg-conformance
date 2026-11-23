// SPDX-License-Identifier: Apache-2.0
// Reference-oracle behaviour for the 2L vectors (vectors/2l): the few task-specific refusals the specifications state as mechanics,
// and the mutants that break each. Everything else the reference does for a 2L task is the generic plain-task behaviour (schema,
// declared policy, a schema-valid answer). Hooked into the reference adapter by one call (reference.ts, plain-task branch).
// No governance is implemented: the reference has no roles, no policy and no acceptance rules.
import type { PlainTask } from "../../plain/catalog.ts";
import { UNKNOWN_ID } from "./2l-catalog.ts";

export const TWO_L_MUTANTS = {
  relayChainUnchecked: "accepts a notifications/relay whose forwarded layers are not a chain of notify and relay documents each addressed to the relayer carrying it (2L notifications)",
  auditCursorAccepted: "answers an audit/list request that carries a cursor it never issued instead of refusing it with invalidCursor (2L audit)",
  unknownIdAccepted: "answers a request that names an identifier that names nothing with a success response instead of the task's not-found code (2L inbox, join requests, invitations)",
} as const;

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

const NOTIFY = "https://trusttasks.org/spec/notifications/notify/0.1";
const RELAY = "https://trusttasks.org/spec/notifications/relay/0.1";

/**
 * Walk the `forwarded` chain of a relay as notifications/relay 0.1 consumer item 2 states it (structure only: the reference does not
 * verify the proofs inside the chain). Each layer is a notify or relay document; its recipient is the issuer of the layer carrying it;
 * the innermost layer is a notify; at most four relays in all counting the outer one.
 */
function chainHolds(outerIssuer: unknown, payload: unknown): boolean {
  let carrierIssuer = outerIssuer;
  let relays = 1;
  let cur: unknown = isObj(payload) ? payload["forwarded"] : undefined;
  for (;;) {
    if (!isObj(cur)) return false;
    if (cur["recipient"] !== carrierIssuer) return false;
    if (cur["type"] === NOTIFY) return true;
    if (cur["type"] !== RELAY) return false;
    if (++relays > 4) return false;
    carrierIssuer = cur["issuer"];
    cur = isObj(cur["payload"]) ? cur["payload"]["forwarded"] : undefined;
  }
}

/** The refusal the specification of `task` states for this request, or undefined when the generic behaviour applies. */
export function twoLRefusal(task: PlainTask, doc: { issuer: string; payload: unknown }, mutated: (id: keyof typeof TWO_L_MUTANTS) => boolean): { code: string; message: string } | undefined {
  if (task.slug === "notifications/relay" && !mutated("relayChainUnchecked") && !chainHolds(doc.issuer, doc.payload)) {
    return { code: "notifications/relay:chainInvalid", message: "a layer of the relay does not hold" };
  }
  if (task.slug === "audit/list" && isObj(doc.payload) && doc.payload["cursor"] !== undefined && !mutated("auditCursorAccepted")) {
    return { code: "audit/list:invalidCursor", message: "the cursor was not issued by this maintainer" };
  }
  const u = UNKNOWN_ID[task.slug];
  if (u !== undefined && isObj(doc.payload) && doc.payload[u.member] !== undefined && !mutated("unknownIdAccepted")) {
    const known = isObj(task.validPayload) ? task.validPayload[u.member] : undefined;
    if (doc.payload[u.member] !== known) return { code: u.code, message: "no such identifier" };
  }
  return undefined;
}
