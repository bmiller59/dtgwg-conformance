// SPDX-License-Identifier: Apache-2.0
// The reference oracle's tiny stateful model for the seeded-state probe (docs/22, decision CV-16): it remembers the rooms and git
// namespaces a valid `rooms/create` or `git-ns/namespace/bind` request made, and nothing else. The reference validates every payload
// before it looks anything up (SPEC.md 7.2 item 2), so for a room or namespace that exists and for one that does not it answers
// malformedRequest to a schema-invalid payload. The mutant `lookupFirst` is the order the original platform shows: it looks the
// named room or namespace up first and answers a not-found (`taskFailed`) for one it does not hold, before it checks the payload.
// A request that names a room or namespace it HOLDS is validated either way, which is what the seeded probe relies on: the probe
// passes under `lookupFirst` (the order is not the question) and fails under `noPayloadValidation` (a platform that never validates).
import type { PlainTask } from "../../plain/catalog.ts";
import { REISSUES, reissueMutantId, ruleOf } from "../../coverage/probe.ts";

export const SEEDED_STATE_MUTANTS = {
  lookupFirst: "looks the room or git namespace a request names up before it validates the payload, and answers a not-found (taskFailed) for one it does not hold (room and git-ns tasks)",
} as const;
/** One per re-issued retired behavioural rule: the refusal the text states is not enforced although the object exists. */
export const REISSUE_MUTANTS: Record<string, string> = {
  ...Object.fromEntries(REISSUES.map((r) => [reissueMutantId(r.of), `does not enforce the refusal of the re-issued ${r.of} (${ruleOf(r.of).title}) although the room or key it names exists`])),
};

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

const ROOM_CREATE = "https://trusttasks.org/spec/rooms/create/0.2";
const ROOM_CREATE_03 = "https://trusttasks.org/spec/rooms/create/0.3"; // the version rooms/records/prune 0.2 links (O-05)
const NS_BIND = "https://trusttasks.org/spec/git-ns/namespace/bind/0.2";
const KEY_CREATE = "https://trusttasks.org/spec/keys/create/0.1";

export class SeededState {
  private readonly rooms = new Set<string>();
  private readonly namespaces = new Set<string>(); // ids and `forge/owner`
  private readonly keys = new Set<string>();

  reset(): void { this.rooms.clear(); this.namespaces.clear(); this.keys.clear(); }

  /** A valid, accepted request that creates the object: remember it. `response` is the payload the reference answered with. */
  record(task: PlainTask, payload: unknown, response: unknown): void {
    if (!isObj(payload)) return;
    if ((task.typeUri === ROOM_CREATE || task.typeUri === ROOM_CREATE_03) && typeof payload["roomId"] === "string") this.rooms.add(payload["roomId"]);
    if (task.typeUri === KEY_CREATE && typeof payload["keyId"] === "string") this.keys.add(payload["keyId"]);
    if (task.typeUri === NS_BIND) {
      this.namespaces.add(`${String(payload["forge"])}/${String(payload["owner"])}`);
      const ns = isObj(response) && isObj(response["namespace"]) ? response["namespace"]["id"] : undefined;
      if (typeof ns === "string") this.namespaces.add(ns);
    }
  }

  /** The task is one the mutant treats as a lookup of a room or namespace, and the payload names one the reference does not hold (a missing or non-string member names none). */
  unknownObject(task: PlainTask, payload: unknown): boolean {
    const props = isObj(task.payloadSchema["properties"]) ? (task.payloadSchema["properties"] as J) : {};
    const p = isObj(payload) ? payload : {};
    if ("roomId" in props && task.typeUri !== ROOM_CREATE && task.typeUri !== ROOM_CREATE_03) return typeof p["roomId"] !== "string" || !this.rooms.has(p["roomId"]);
    if (task.slug.startsWith("git-ns/") && task.typeUri !== NS_BIND) {
      if ("namespace" in props) return typeof p["namespace"] !== "string" || !this.namespaces.has(p["namespace"]);
      if ("resource" in props) { const m = typeof p["resource"] === "string" ? /^([^/]+\/[^/]+)\//.exec(p["resource"]) : null; return m === null || !this.namespaces.has(m[1]!); }
    }
    return false;
  }

  /**
   * A re-issued retired rule: the refusal the text states, once the room or key the request names exists (the retired vector needed that
   * state, which is why it was a tombstone). Only for the rules listed in REISSUES; the mutant `bs:<rule key>` switches one off.
   */
  reissueRefusal(task: PlainTask, payload: unknown, mutated: (id: string) => boolean): { code: string; message: string } | undefined {
    if (!isObj(payload)) return undefined;
    for (const r of REISSUES) {
      const rule = ruleOf(r.of);
      if (rule.slug !== task.slug || rule.version !== task.version || mutated(reissueMutantId(r.of))) continue;
      const named = payload[r.member];
      if (typeof named !== "string" || !(r.kind === "room" ? this.rooms : this.keys).has(named)) continue;
      if (rule.refuses(payload, task)) return { code: rule.codes[0]!, message: rule.title };
    }
    return undefined;
  }
}
