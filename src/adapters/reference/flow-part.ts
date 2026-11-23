// SPDX-License-Identifier: Apache-2.0
// Reference adapter: the shared shape of the two small ceremony parties that model one flow each (vetting-party.ts for FC-VET, onboarding-party.ts for FC-ONB; docs/25).
// A flow part holds the records one scenario observes, serves the task types its role receives, starts the documents its kinds name and reads a thread for the
// scenario runner. It is never a model of a real service: it models only what a scenario observes (docs/25 sections 6.6 and 6.7).
import type { CeremonyState, InitiateParams, InitiateResult } from "../../adapter/contract.ts";
import type { ed25519Signer } from "../../crypto/didkey.ts";
import type { CeremonyMutantId } from "./ceremony-party.ts";

export type Doc = Record<string, unknown>;
export type Signer = ReturnType<typeof ed25519Signer>;

/** A payload schema of the reference's small validator: what a served type's payload must carry. */
export interface FlowSchema {
  required: string[];
  properties: Record<string, { type: "string" | "boolean" | "object" | "array" | "number" | "any"; pattern?: string; maxItems?: number; itemType?: "string" }>;
}

/** What a flow part borrows from the reference adapter. */
export interface FlowHost {
  did: string;
  signer: Signer;
  now(): number;
  newId(): string;
  stamp(): string;
  mutated(id: CeremonyMutantId): boolean;
  isConnected(vid: string): boolean;
  /** Addressing, the timestamp and the signature of a reply this party emits. */
  finish(reply: Doc, request: Doc, errorKind: boolean): Doc;
  /** An error reply to `request` with a Trust Tasks error code. */
  refuse(request: Doc, code: string, message: string): Doc;
  /** A document this party pushes on its own to its recipient (the runner relays it): the reference's pushed-document box. */
  pushDoc(doc: Doc): void;
  holdsCredential(digest: string): boolean;
}

export interface FlowPart {
  readonly kinds: string[];
  readonly roles: { ceremony: string; roles: string[] }[];
  /** The task types this part's roles receive (they are listed in the party's supported types). */
  types(): string[];
  schema(type: string): FlowSchema | undefined;
  /** An accepted document of a served type: the reply (unfinished), an error, or nothing. */
  handle(doc: Doc): Doc | undefined;
  initiate(p: InitiateParams): InitiateResult;
  /** An answer to something this part started or recorded (a `#response` or an error on one of its threads, from its peer). Returns the replies to send back, unfinished. */
  receive(doc: Doc): Doc[] | undefined;
  owns(doc: Doc): boolean;
  reading(thread: string): CeremonyState | undefined;
  /** A stored credential count of a kind this part keeps (`stored {kind}`), or undefined. */
  stored?(kind: string): number | undefined;
  /** A `policy` trigger argument this part understands. */
  policy?(args: Record<string, unknown>): boolean;
  reset(): void;
}

export const isDoc = (x: unknown): x is Doc => typeof x === "object" && x !== null && !Array.isArray(x);
export const errorOf = (doc: Doc): boolean => String(doc.type ?? "").includes("/trust-task-error/");
