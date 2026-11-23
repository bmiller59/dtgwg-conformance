// SPDX-License-Identifier: Apache-2.0
// Adapter helper for the optional capability `observe.pushed` (docs/20-observing-pushed-documents.md).
//
// Some answers are not replies. In credential-exchange the answer to an `offer` is the holder's `request`, and the answer to a `request` is
// the issuer's `issue`: a new task the implementation sends to the counterparty, on the same thread. An adapter that can see what its
// implementation sent records each such document here and answers `observe {query: "pushed"}` from it.
//
// Wiring in an adapter (inbox/outbox shape):
//
//   const outbox = new PushedBox();                       // one per adapter; clear it in reset()
//   // 1. where the implementation hands a document to its transport (or its outbox table), not where it replies to `send`:
//   outbox.record(documentText, recipientVid);            // `to` defaults to the document's own `recipient` member
//   // 2. in observe():
//   if (q.query === "pushed") return outbox.observe(q);   // { value: count, documents: [...] }
//   // 3. in capabilities(): optional: [..., "observe.pushed"]  (declare it only if EVERY pushed document is recorded, else vectors misreport)
//
// An implementation with a durable outbox table can skip the class and implement the same filter over its rows.
import type { ObserveResult } from "./contract.ts";

export interface PushedFilter {
  threadId?: string;
  to?: string;
  type?: string;
}

interface Entry {
  text: string;
  to: string;
  type: string;
  threadId: string;
}

/** The thread a document belongs to: its `threadId`, or its own `id` when it opens one (framework threading rule). */
export function threadOf(doc: Record<string, unknown>): string {
  return typeof doc.threadId === "string" ? doc.threadId : String(doc.id ?? "");
}

export class PushedBox {
  private readonly entries: Entry[] = [];

  /** Record a document sent to `to` (default: its `recipient` member). A string is kept verbatim; an object is serialised. */
  record(doc: string | Record<string, unknown>, to?: string): void {
    const text = typeof doc === "string" ? doc : JSON.stringify(doc);
    const o = JSON.parse(text) as Record<string, unknown>;
    this.entries.push({ text, to: to ?? String(o.recipient ?? ""), type: String(o.type ?? ""), threadId: threadOf(o) });
  }

  /** The matching documents, oldest first. */
  query(filter: PushedFilter = {}): string[] {
    return this.entries
      .filter((e) => (filter.to === undefined || e.to === filter.to) && (filter.type === undefined || e.type === filter.type) && (filter.threadId === undefined || e.threadId === filter.threadId))
      .map((e) => e.text);
  }

  /** Answer an `observe {query: "pushed"}`. */
  observe(q: PushedFilter): ObserveResult {
    const documents = this.query(q);
    return { value: documents.length, documents };
  }

  /** Remove documents recorded verbatim (a harness stand-in that replaces what the implementation pushed with a changed copy, src/ceremony/tamper.ts). */
  drop(texts: string[]): void {
    for (const t of texts) {
      const i = this.entries.findIndex((e) => e.text === t);
      if (i >= 0) this.entries.splice(i, 1);
    }
  }

  clear(): void {
    this.entries.length = 0;
  }
}
