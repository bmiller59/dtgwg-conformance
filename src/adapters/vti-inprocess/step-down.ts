// SPDX-License-Identifier: Apache-2.0
// Version step-down for the harness's own calls to the VTA (class D, a harness-side request ladder; no platform is changed).
//
// The harness asks the newest version of a task it knows and falls back to an older version the host serves, so an older platform is
// measured on what it really serves instead of failing at setup. Basis: trust-task-discovery 0.4, "A discoverer SHOULD ask in 0.4, and MAY
// fall back to 0.3, then 0.2, then 0.1, for a responder that does not list or rejects the later version", and SPEC 8.3 (`unsupportedVersion`
// names the served versions in `details.servedVersions`, as the pin's answer does). The ladder is a request step only: it adds no answer, and a
// refusal of any other code, or a host that serves none of the rungs, still fails the call with the host's own words.

/** The type URI (without a fragment) of each ladder, newest first. Only calls whose answer the harness reads alike across the rungs are listed. */
const ACL_LIST = "https://trusttasks.org/spec/acl/list";
export const VERSION_LADDERS: Readonly<Record<string, readonly string[]>> = {
  [`${ACL_LIST}/0.4`]: [`${ACL_LIST}/0.4`, `${ACL_LIST}/0.3`, `${ACL_LIST}/0.2`],
};

/** A task the VTA answered with a trust-task-error: the code and details are kept so a caller can tell a refused version from any other refusal. */
export class TaskRefusal extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "TaskRefusal";
    this.code = code;
    this.details = details;
  }
}

/** The type URIs a refusal says the host serves (`details.servedVersions`), or undefined when it names none. */
export function servedVersions(refusal: TaskRefusal): string[] | undefined {
  const d = refusal.details;
  if (typeof d !== "object" || d === null) return undefined;
  const s = (d as Record<string, unknown>).servedVersions;
  return Array.isArray(s) ? s.filter((v): v is string => typeof v === "string") : undefined;
}

/**
 * Ask `type` through `call`, stepping down its ladder on `unsupportedVersion`. The next rung is the newest lower rung the refusal lists as served; when it
 * lists none, the next lower rung. The rung that answered is remembered in `memo` for later calls on the same host. `onStep` is told of each step (for a trace).
 */
export async function askSteppingDown<T>(
  type: string,
  call: (type: string) => Promise<T>,
  memo: Map<string, string>,
  onStep?: (from: string, to: string) => void,
): Promise<T> {
  const ladder = VERSION_LADDERS[type];
  if (ladder === undefined) return call(type);
  let i = ladder.indexOf(memo.get(type) ?? type);
  if (i < 0) i = 0;
  for (;;) {
    const rung = ladder[i]!;
    try {
      const out = await call(rung);
      memo.set(type, rung);
      return out;
    } catch (e) {
      if (!(e instanceof TaskRefusal) || e.code !== "unsupportedVersion") throw e;
      const served = servedVersions(e);
      let next = i + 1;
      while (next < ladder.length && served !== undefined && !served.includes(ladder[next]!)) next++;
      if (next >= ladder.length) throw e;
      onStep?.(rung, ladder[next]!);
      i = next;
    }
  }
}
