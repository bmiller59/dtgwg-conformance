// SPDX-License-Identifier: Apache-2.0
// Turns the at-a-glance model into a small document tree and renders it as Markdown and as one self-contained HTML page.
import { specPinLine } from "./spec-pin.ts";
import { SPEC_CHANGED_TEXT } from "../vectors/spec-flags.ts";
import { CELL_WORD, MEASURES, headlineMeasure, ordered, cellKind, pct, reachText, type CellKind, type Counts, type Model, type Subject, type SurfaceModel, type Row, sanitizeText, refMd, runRef } from "./model.ts";

interface Cell { t: string; kind?: CellKind; label?: string }
type Block =
  | { k: "h"; level: number; text: string; id: string }
  | { k: "p"; text: string }
  | { k: "box"; title: string; items: string[]; tone: "info" | "warn" }
  | { k: "ul"; items: string[] }
  | { k: "table"; head: string[]; rows: Cell[][]; cls: string; caption?: string }
  | { k: "details"; summary: string; blocks: Block[] }
  | { k: "legend"; items: { kind: CellKind }[] };

const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;
const KIND_LABEL: Record<string, string> = { shim: "stand-in carrier", "in-process": "in process", "in-process-vtc": "community service in process", emit: "sending side", didcomm: "real DIDComm", live: "live service", reference: "the suite's own adapter" };

function headline(s: Subject): SurfaceModel | undefined { return s.surfaces.find((x) => x.cfg.headline === true) ?? s.surfaces[0]; }

/** Cell for a subject and a grid row: first surface with results for the row, else a declared reading, else not reachable / no run. */
function gridCell(model: Model, s: Subject, row: Row): { kind: CellKind; counts?: Counts; surface?: SurfaceModel; note?: string } {
  for (const sf of s.surfaces) {
    const c = sf.byRow[row.id];
    if (c !== undefined && c.total > 0) return { kind: cellKind(c), counts: c, surface: sf };
  }
  const d = s.cfg.declared?.[row.id];
  if (d !== undefined) return { kind: d.class === "not-applicable" ? "not-applicable" : d.class === "version-mismatch" ? "version-mismatch" : "not-reached", note: d.reason };
  if (s.cfg.notReachable !== undefined) return { kind: "not-reachable" };
  return { kind: "none" };
}

function cellText(c: { kind: CellKind; counts?: Counts; surface?: SurfaceModel; note?: string }, model: Model): Cell {
  const w = CELL_WORD[c.kind];
  let extra = "";
  if (c.counts !== undefined) {
    const n = c.counts;
    if (n.ran > 0) extra = `${reachText(n)} run`;
    else {
      const bits = [n.notApplicable > 0 ? `${n.notApplicable} not applicable` : "", n.notReached + n.unclassified > 0 ? `${n.notReached + n.unclassified} not reached` : "", n.versionMismatch > 0 ? `${n.versionMismatch} other version` : ""].filter((x) => x !== "");
      extra = `none run: ${bits.join(", ")}`;
    }
    if (c.surface !== undefined && model.subjects.find((x) => x.surfaces.includes(c.surface!))!.surfaces.length > 1) extra += `; ${KIND_LABEL[c.surface.cfg.how] ?? c.surface.cfg.how}`;
    if (c.surface?.recordedEarlier === true) extra += "; recorded earlier";
  }
  return { t: `${w.glyph} ${w.word}`, kind: c.kind, label: extra };
}

function measureRows(sf: SurfaceModel, withUnclassified: boolean, withFail: boolean): { head: string[]; rows: Cell[][] } {
  const head = ["Part", "Ran of applicable", "Agree", "Differ from the specs", "Unclear spec points", ...(withFail ? ["Needs a look"] : []), "Not applicable", "Not reached yet", "Different version", ...(withUnclassified ? ["Unclassified"] : [])];
  const rows: Cell[][] = [];
  for (const m of MEASURES) {
    const c = sf.byMeasure[m.id];
    if (c === undefined || c.total === 0) continue;
    const label = m.channel === "proposed" ? `${m.label}` : m.label;
    rows.push([
      { t: label }, { t: `${c.ran} of ${c.applicable} (${pct(c.ran, c.applicable)})` }, { t: String(c.pass) }, { t: String(c.knownFail) }, { t: String(c.clarify) },
      ...(withFail ? [{ t: String(c.fail) }] : []), { t: String(c.notApplicable) }, { t: String(c.notReached) }, { t: String(c.versionMismatch) }, ...(withUnclassified ? [{ t: String(c.unclassified) }] : []),
    ]);
  }
  return { head, rows };
}

/**
 * The essential governance E of a surface, as a visible label: single-party for a declared set of one; "E not recorded" for older
 * runs; a declaration mismatch of the adapter honesty check first, in bold, since it counts as FAIL.
 */
export function essentialLabel(sf: SurfaceModel): string {
  const e = sf.essential;
  if (e === null) return "E not recorded (the run predates the record of essential governance)";
  if (e.source === "unreadable") return `E unreadable (GOV-NOT-PROBED)${e.reason === undefined ? "" : `: ${e.reason}`}`;
  const kind = e.singleParty ? "**single-party**: an authority set of one" : `${e.minApprovals ?? "?"} of an authority set of ${e.members}`;
  const label = `${kind}, declared from ${e.source.replace(/-/g, " ")}${e.finding === "GOV-FIXED" ? " (GOV-FIXED: a fixed built-in rule)" : ""}`;
  const p = e.probe;
  if (p === undefined) return `${label}; honesty check not recorded`;
  if (p.result === "mismatch") return `**GOV-DECLARATION-MISMATCH** (counts as FAIL; the results that rest on E are FAIL): ${p.observed ?? "the declaration does not match the behaviour"}. Declared: ${label}`;
  if (p.result === "consistent") return `${label}; the honesty check found the behaviour consistent with it`;
  return `${label}; honesty check ${p.result === "not-probed" ? "not probed (GOV-NOT-PROBED)" : "not run"}${p.reason === undefined ? "" : `: ${p.reason}`}`;
}

function paragraph(s: Subject, model: Model): string {
  const h = headline(s);
  if (s.cfg.notReachable !== undefined && h === undefined) {
    const total = model.catalog.byKind["core"] ?? 0;
    return `**What it is.** ${s.cfg.whatItIs} **What we could test.** Nothing: 0 of the suite's ${total} core checks could be run. **What we found.** ${s.cfg.notReachable.text}`;
  }
  if (h === undefined) return `**What it is.** ${s.cfg.whatItIs} **What we could test.** No result has been recorded.`;
  const c = h.byMeasure["core"]!;
  const dev = c.knownFail + c.fail;
  const how = model.config.how[h.cfg.how]!;
  const parts: string[] = [`**What it is.** ${s.cfg.whatItIs}`];
  parts.push(`**What we could test.** ${h.cfg.label}: ${how.plain} Of the ${c.applicable} core checks that apply to it (registry specifications), we ran ${c.ran} (${pct(c.ran, c.applicable)}). ${plural(c.notApplicable, "further check")} ${c.notApplicable === 1 ? "does" : "do"} not apply because the platform does not implement that part, ${c.notReached} could not be reached yet by our test setup${c.versionMismatch > 0 ? `, and ${c.versionMismatch} need a different version of the task than the platform offers` : ""}.`);
  const others = MEASURES.filter((m) => m.id !== "core" && m.id !== "core-candidate" && (h.byMeasure[m.id]?.total ?? 0) > 0).map((m) => `${m.label.toLowerCase()} ${h.byMeasure[m.id]!.ran} of ${h.byMeasure[m.id]!.applicable}`);
  const wit = s.surfaces.filter((x) => x !== h).flatMap((x) => MEASURES.filter((m) => (x.byMeasure[m.id]?.total ?? 0) > 0 && m.id !== "core-candidate").map((m) => `${m.label.toLowerCase()} ${x.byMeasure[m.id]!.ran} of ${x.byMeasure[m.id]!.applicable} (${KIND_LABEL[x.cfg.how] ?? x.cfg.how}${x.recordedEarlier ? ", recorded earlier" : ""})`));
  if (others.length + wit.length > 0) parts[parts.length - 1] += ` Other parts: ${[...others, ...wit].join("; ")}.`;
  parts.push(`**What we found.** Of the ${c.ran} core checks that ran, ${c.pass} agree with the specification, ${dev} differ from it${c.fail > 0 ? ` (${c.fail} not yet explained)` : ""}${h.findings.length > 0 ? ` (${plural(h.findings.length, "distinct difference")}, each recorded with a reason)` : ""}, and ${c.clarify} turn on a point the specifications leave open.${h.recordedEarlier ? " This surface was recorded earlier and not re-run on the current set of checks." : ""}`);
  parts.push(`**Essential governance (who may decide, how many approvals).** ${essentialLabel(h)}.`);
  if (s.cfg.role === "stand-in") parts.push("**Reading it.** This is a measurement stand-in, not a platform.");
  if (s.cfg.role === "self-check") parts.push("**Reading it.** It is expected to agree with the checks; a difference here would point at the suite, not at a platform.");
  return parts.join(" ");
}

function subjectBlocks(s: Subject, model: Model): Block[] {
  const out: Block[] = [];
  const role = s.cfg.role === "platform" ? "" : s.cfg.role === "self-check" ? " (the suite checking itself)" : " (measurement stand-in, not a platform)";
  out.push({ k: "h", level: 3, text: `${s.cfg.name}${role}`, id: s.cfg.id });
  out.push({ k: "p", text: paragraph(s, model) });
  for (const sf of s.surfaces) {
    const how = model.config.how[sf.cfg.how]!;
    const wf = sf.results.some((r) => r.status === "FAIL");
    const wu = sf.results.some((r) => r.cls === "unclassified");
    const mr = measureRows(sf, wu, wf);
    const early = sf.recordedEarlier ? ` **Recorded earlier**: ${sf.earlierWhy.join("; ")}.` : "";
    const sub: Block[] = [];
    sub.push({ k: "p", text: `**How it was tested: ${how.name}.** ${how.plain} Run folders (in the results directory): ${sf.runs.map((r) => runRef(r)).join(", ")}.${early}` });
    sub.push({ k: "table", head: mr.head, rows: mr.rows, cls: "counts", caption: `${sf.cfg.label}: Tier 1 results, registry parts first; the candidate part is advisory (not an endorsement)` });
    sub.push({ k: "p", text: `**Essential governance.** ${essentialLabel(sf)}.` });
    sub.push({ k: "p", text: `**Task types.** Of ${sf.types.total} task types in the checks recorded for this surface, ${sf.types.ran} had at least one check run, ${sf.types.notApplicable} do not apply, and ${sf.types.other} are not yet tested.` });
    if (sf.staleExceptions.length > 0) sub.push({ k: "p", text: `**Recorded exceptions that no longer apply on this surface.** ${plural(sf.staleExceptions.length, "check")} here pass${sf.staleExceptions.length === 1 ? "es" : ""} although an exception recorded for the platform names ${sf.staleExceptions.length === 1 ? "it" : "them"} (counted as PASS above): ${sf.staleExceptions.join(", ")}. The exceptions are left as they are.` });
    if (sf.governanceNotes > 0) sub.push({ k: "p", text: `**Values chosen by the test adapter.** ${sf.governanceNotes} of the documents the wallet's builders emitted rely on a value the builder chose itself (for example a role or a policy module). Those results show the wallet can build the document, not that the value is the wallet's own policy.` });
    sub.push({ k: "p", text: `**Top findings** (differences from the specifications or from what a check expects; each is recorded with a reason).` });
    if (sf.findings.length === 0 && sf.unexplained.length === 0 && sf.recorded.length === 0) sub.push({ k: "p", text: "None recorded on this surface." });
    else {
      const rows = sf.findings.slice(0, 8).map((f): Cell[] => [{ t: f.title }, { t: f.category }, { t: `${f.vectors.length}: ${f.vectors.slice(0, 4).join(", ")}${f.vectors.length > 4 ? ", ..." : ""}` }, { t: refMd(f.link, f.linkLabel, "") }]);
      for (const f of [...sf.recorded].reverse()) rows.unshift([{ t: f.explanation }, { t: "Recorded finding, not excused (still FAIL)" }, { t: f.vector }, { t: refMd(f.link, f.linkLabel, "") }]);
      for (const id of sf.unexplained) rows.unshift([{ t: `Unexplained difference in ${id}` }, { t: "Needs a look" }, { t: id }, { t: `run folder ${runRef(sf.newestRun)}` }]);
      sub.push({ k: "table", head: ["Finding", "Kind", "Checks", "Detail"], rows, cls: "findings" });
      if (sf.findings.length > 8) sub.push({ k: "p", text: `${sf.findings.length - 8} more are recorded in [exceptions](../exceptions/exceptions.json).` });
    }
    out.push({ k: "details", summary: `${sf.cfg.label}: counts, how tested, findings`, blocks: sub });
  }
  out.push({ k: "p", text: "**What is next for this platform.**" });
  out.push({ k: "ul", items: nextItems(s) });
  return out;
}

/** The hand-written next steps plus the biggest not-reached reasons and any unclassified skip reasons of the headline surface. */
export function nextItems(s: Subject): string[] {
  const gaps: string[] = [];
  const h = headline(s);
  if (h !== undefined) {
    const nr = h.reasons.filter((r) => r.cls === "not-reached").slice(0, 3);
    for (const r of nr) gaps.push(`Reach ${plural(r.count, "more check")}. ${sanitizeText(r.note)}`);
    const un = h.reasons.filter((r) => r.cls === "unclassified").length;
    if (un > 0) gaps.push(`Classify ${plural(un, "skip reason")} that no rule covers yet.`);
  }
  return [...s.cfg.next, ...gaps];
}

export function buildDoc(model: Model): Block[] {
  const b: Block[] = [];
  const first = ordered(model);
  b.push({ k: "p", text: `**Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Generated from the run folders of the results directory, which are kept outside this repository (run set \`${model.runSet}\`, newest run dated ${model.newestDate}; [docs/04 section 21](../docs/04-suite-design.md#21-where-run-records-live-built)). Regenerate with \`npm run at-a-glance\`; do not edit by hand.` });
  const pinLine = specPinLine(model.specPin);
  if (pinLine !== "") b.push({ k: "p", text: `${pinLine}. SPEC-CHANGED: ${SPEC_CHANGED_TEXT}; such a check is never counted as a pass or a difference until reviewed (docs/23).` });
  b.push({ k: "box", title: "How to read this", tone: "info", items: [
    "Each platform is measured against the same written checks (vectors). A check either agrees with the specification (pass), differs from it (a recorded deviation), rests on a point the specifications leave open (unclear), or was not tested.",
    "Not tested comes in three kinds, kept apart: not applicable (the platform does not implement it), not reached yet (our test setup cannot drive it yet, which says nothing about the platform) and different version (the platform offers the task at another version).",
    "Reach is shown against what applies: checks run out of (all checks minus not applicable).",
    "The target is the latest version of each trust task (decision D245, 2026-11-20). Older versions are out of focus: their checks stay in the suite and stay runnable, but they are not part of the latest-version figures below, and a platform not reaching an older version is out of scope, not a gap. The table \"Latest versions only\" splits what ran by version.",
    "How a platform was tested changes what the result means; it is stated beside every number.",
    "Results against registry specifications are the headline. Results for candidates (behaviour with no home in the Trust Tasks repository, implemented by one or a few platforms) are advisory, not an endorsement, and shown separately.",
    "Platforms are listed in the order VTI, keyring-wallet, truststackers, then the suite's own adapter. The order is not a ranking.",
    "Words used on this page: pass = PASS, unclear = CLARIFY, recorded deviation (differs) = KNOWN-FAIL, unexplained = FAIL, not tested = SKIP. The full mapping and every term: [glossary](../docs/03-glossary.md#status-codes-and-plain-words).",
  ] });
  b.push({ k: "box", title: "What this is not", tone: "warn", items: [
    "Not a ranking. Platforms are measured in different ways, so counts cannot be compared across them.",
    "It awards no status to any platform and endorses no platform or specification.",
    "Not a governance judgement. A difference may sit in the platform, in a specification, or in our checks; each recorded difference says which it appears to be.",
    "A draft: the checks, the classification of skipped checks and this page are all still changing.",
  ] });

  b.push({ k: "h", level: 2, text: "In one line each", id: "summary" });
  b.push({ k: "ul", items: first.flatMap((s) => {
    const tag = s.cfg.role === "platform" ? "" : s.cfg.role === "self-check" ? " (suite checking itself)" : " (measurement stand-in, not a platform)";
    if (s.surfaces.length === 0) return [`**${s.cfg.name}${tag}**: could not be reached; nothing was run.`];
    return s.surfaces.map((sf) => {
      const m = headlineMeasure(sf);
      if (m === undefined) return `**${s.cfg.name}${tag}**, ${sf.cfg.label.toLowerCase()}: no result recorded.`;
      const c = sf.byMeasure[m]!;
      const part = ({ core: "core checks", emit: "sending-side checks", witness: "witness server checks", plain: "single-task checks" } as Record<string, string>)[m] ?? "checks";
      return `**${s.cfg.name}${tag}**, ${sf.cfg.label.charAt(0).toLowerCase()}${sf.cfg.label.slice(1)}: ran ${c.ran} of ${c.applicable} applicable ${part} (${KIND_LABEL[sf.cfg.how] ?? sf.cfg.how}); ${c.pass} agree, ${c.knownFail + c.fail} differ, ${c.clarify} unclear.${c.specChanged > 0 ? ` ${c.specChanged} flagged spec-changed (not re-checked, not counted).` : ""}${c.quarantined > 0 ? ` ${c.quarantined} quarantined as flaky (advisory, not counted).` : ""}${sf.recordedEarlier ? " Recorded earlier." : ""}`;
    });
  }) });
  b.push({ k: "h", level: 2, text: "Status grid", id: "grid" });
  b.push({ k: "p", text: "Rows are parts of the suite; columns are platforms (VTI, keyring-wallet and truststackers), then the measurement aid. Every cell has a word and a symbol as well as a colour. \"Ran\" is checks run out of checks that apply." });
  const cols = first;
  const rows: Cell[][] = model.config.rows.map((r) => [{ t: `**${r.label}**`, label: r.plain }, ...cols.map((s) => cellText(gridCell(model, s, r), model))]);
  b.push({ k: "table", head: ["Part", ...cols.map((s) => s.cfg.role === "platform" ? s.cfg.name : s.cfg.role === "self-check" ? `${s.cfg.name} (suite checking itself)` : `${s.cfg.name} (stand-in only)`)], rows, cls: "grid" });
  b.push({ k: "legend", items: (["agrees", "agrees-open", "differences", "unexplained", "not-applicable", "not-reached", "version-mismatch", "none", "not-reachable"] as CellKind[]).map((kind) => ({ kind })) });

  b.push({ k: "h", level: 2, text: "The platforms", id: "platforms" });
  for (const s of first.filter((x) => x.cfg.role === "platform")) b.push(...subjectBlocks(s, model));
  b.push({ k: "h", level: 2, text: "Measurement aids, not platforms", id: "aids" });
  b.push({ k: "p", text: "The reference adapter is shown apart on purpose: it shows the suite is consistent with itself and says nothing about any platform." });
  for (const s of first.filter((x) => x.cfg.role !== "platform")) b.push(...subjectBlocks(s, model));

  b.push({ k: "h", level: 2, text: "Registry results and candidate results", id: "channels" });
  b.push({ k: "p", text: "Registry means the check is based on a specification published in the registry. Candidate means it covers behaviour that has no home in the Trust Tasks repository but is implemented by one or a few platforms and may be adopted later; every other check cites a Trust Tasks repository artifact. Suite design (proposed) covers the suite's own ceremony and two-phase design choices, which no specification states. The registry results are the headline; candidate and suite-design results are advisory, not an endorsement, never change an overall result, and are shown here separately." });
  const crow: Cell[][] = [];
  for (const s of first) for (const sf of s.surfaces) {
    const r = sf.byMeasure["core"]!, p = sf.byMeasure["core-candidate"]!, d = sf.byMeasure["core-proposed"]!;
    if (r.total + p.total + d.total === 0) continue;
    crow.push([{ t: `${s.cfg.name}, ${KIND_LABEL[sf.cfg.how] ?? sf.cfg.how}` }, { t: `${r.ran} of ${r.applicable}; ${r.pass} agree, ${r.knownFail + r.fail} differ, ${r.clarify} unclear` }, { t: p.total === 0 ? "no candidate checks in this run" : `${p.ran} of ${p.applicable}; ${p.pass} agree, ${p.knownFail + p.fail} differ, ${p.clarify} unclear` }, { t: d.total === 0 ? "no suite-design checks in this run" : `${d.ran} of ${d.applicable}; ${d.pass} agree, ${d.knownFail + d.fail} differ, ${d.clarify} unclear` }]);
  }
  b.push({ k: "table", head: ["Platform and surface", "Registry, core (headline)", "Candidate (advisory)", "Suite design, proposed (advisory)"], rows: crow, cls: "counts" });

  // Latest versions only (decision D245): what ran, by the focus class of the version each check names.
  b.push({ k: "h", level: 3, text: "Latest versions only", id: "latest-only" });
  b.push({ k: "p", text: "Registry checks that ran (a result other than SKIP) on each surface, by the version of the task each check names: the latest version of its task (focus, the target), an older version (non-focus: kept and runnable, outside the latest-version figures), a task whose latest version is retired (out of the target), or no task version (framework checks). The focus class comes from the coverage matrix (`results/coverage/matrix.json`)." });
  const lrow: Cell[][] = [];
  for (const s of first) for (const sf of s.surfaces) {
    const ran = sf.results.filter((r) => r.channel === "registry" && (r.status === "PASS" || r.status === "CLARIFY" || r.status === "KNOWN-FAIL" || r.status === "FAIL"));
    if (ran.length === 0) continue;
    const n = (c: string | undefined): number => ran.filter((r) => (r.slug === "" ? undefined : model.focus[`${r.slug}/${r.version}`] ?? "none") === c).length;
    lrow.push([{ t: `${s.cfg.name}, ${KIND_LABEL[sf.cfg.how] ?? sf.cfg.how}` }, { t: String(ran.length) }, { t: String(n("focus")) }, { t: String(n("older")) }, { t: String(n("retired")) }, { t: String(ran.length - n("focus") - n("older") - n("retired")) }]);
  }
  b.push({ k: "table", head: ["Platform and surface", "Registry checks that ran", "At the latest version (focus)", "At an older version (non-focus)", "At a retired latest version", "No task version"], rows: lrow, cls: "counts" });
  const vr = model.vtiRoles;
  if (vr !== null) {
    const row = (sid: string): string => { const x = vr.surfaces.find((y) => y.id === sid); return x === undefined ? "" : `${x.label}: ${x.withRole} slugs with a role (${x.roles["serves"] ?? 0} serves, ${x.roles["emits"] ?? 0} emits, ${x.roles["older-version"] ?? 0} only at a lower version)${x.ran["vti"] === null || x.ran["vti"] === undefined ? ", no runs" : `, ${x.ran["vti"]} had a vector executed`}`; };
    b.push({ k: "p", text: `**VTI reach is read per surface against the slugs where that surface has a role, not against all ${vr.focusSlugs} target slugs** (decisions D420 and D421): ${["vta", "vtc", "witness", "voting", "client", "mobile", "mcp"].map(row).join("; ")}. Names in code only (a pin, a list or a table) are shown as not yet built, never as attempted. Roles come from VTI main ${vr.inputs.vti}; a role where the source has no code is a stated prefix rule (judgement). The per-slug table with the code evidence is [coverage/vti-participation.md](coverage/vti-participation.md).` });
  }
  const kr = model.kwReach;
  if (kr !== null) {
    const rl = kr.roles;
    b.push({ k: "p", text: `**keyring-wallet reach is read against the slugs where the wallet has a role, not against all ${kr.focusSlugs} target slugs** (decision D301): a wallet is a client, and most target slugs are service or operator surfaces. Of the ${kr.focusSlugs} target slugs the wallet's source gives it a role in ${kr.withRole} (${rl["serves"] ?? 0} it serves, ${rl["emits"] ?? 0} it emits, ${rl["older-version"] ?? 0} it sends or serves only at a lower version, ${rl["names-only"] ?? 0} it names without a builder or handler); ${kr.notBuilt} are reach class \`not-built\` (families a wallet could use and the source does not) and ${kr.notInvolved} are \`not-involved\` (no wallet role by design). ${kr.platforms.map((p) => `${p.label}: a vector of ${p.covered} of those ${kr.withRole} slugs executed in the recorded runs (${p.platform} skipped), ${p.ceremonySlugs} slugs appear in a ceremony row run with the wallet`).join("; ")}. Ceremony rows are an overlay and are never conformance counts. The per-slug table with the code evidence is [kw-participation](coverage/kw-participation.md).` });
  }

  b.push({ k: "h", level: 2, text: "Conformance measured vs interoperation demonstrated", id: "interop" });
  const io = model.interop;
  b.push({ k: "p", text: "These are two different kinds of evidence. **Conformance measured**: each platform alone did what the specification-based check expects, so a client or server that follows the same standard could in principle exchange those tasks with it. **Interoperation demonstrated**: two real platforms exchanged a real document and the outcome was kept as a recorded artefact." });
  b.push({ k: "p", text: io.ledgerEntries === 0 ? "**Interoperation demonstrated: none recorded yet.** No live cross-platform exchange has been recorded, and the suite itself never makes two platforms exchange documents. Conformance does not demonstrate interoperation." : `**Interoperation demonstrated: ${plural(io.ledgerEntries, "recorded exchange")}.**` });
  if (io.ledgerEntries > 0) b.push({ k: "ul", items: io.ledgerLines });
  b.push({ k: "p", text: "**Conformance-implied agreement** (checks that both platforms ran and both agreed with, each measured alone; not an exchange between them, and not a ranking). Computed earlier by the pair matrix from the runs it names; truststackers is not reachable, so it is in no pair." });
  b.push({ k: "table", head: ["Pair", "Checks both ran", "Checks where both agreed"], rows: io.pairs.map((p): Cell[] => [{ t: p.label }, { t: String(p.ran) }, { t: String(p.both) }]), cls: "counts" });
  b.push({ k: "p", text: `Pair matrix sources (run folders in the results directory): ${io.pairSources.map((r) => runRef(r)).join(", ")}. See [interop tracking](../docs/14-interoperability-tracking.md).` });

  b.push({ k: "h", level: 2, text: "Words used", id: "legend" });
  b.push({ k: "table", head: ["Term", "Plain meaning"], cls: "counts", rows: [
    [{ t: "PASS" }, { t: "The platform did what the check expects. Shown as \"agree\"." }],
    [{ t: "KNOWN-FAIL" }, { t: "The platform differs from what the check expects; the difference has been looked at and recorded with a reason. Shown as \"differ from the specs\"." }],
    [{ t: "CLARIFY" }, { t: "The check rests on a point the specifications do not settle. Reported with its reason, never counted as a failure. Shown as \"unclear spec points\"." }],
    [{ t: "SKIP" }, { t: "The check was not run. Split here into not applicable, not reached yet and different version. Never counted as a pass." }],
    [{ t: "FAIL" }, { t: "A difference that is not yet explained. Shown as \"needs a look\"." }],
    [{ t: "Tier 1" }, { t: "The framework's own requirements. Counts here are Tier 1; the stricter Tier 2 is in the run folders." }],
  ] });
  b.push({ k: "table", head: ["How it was tested", "What that means for the result"], cls: "counts", rows: Object.values(model.config.how).map((h): Cell[] => [{ t: h.name }, { t: h.plain }]) });
  const kinds = ["not-applicable", "not-reached", "version-mismatch"];
  b.push({ k: "p", text: `Skipped checks are sorted by [skip-classes.json](skip-classes.json), which maps each recorded skip reason to ${kinds.join(", ")}. The harness does not yet record the class itself, so this is a most likely reading from the reason text and the run data; where the reading is uncertain the reason is left unclassified and listed below.` });
  if (model.unclassified.length === 0) b.push({ k: "p", text: "Unclassified skip reasons: none." });
  else b.push({ k: "table", head: ["Surface", "Unclassified skip reason", "Checks"], rows: model.unclassified.map((u): Cell[] => [{ t: u.surface }, { t: u.reason }, { t: String(u.count) }]), cls: "counts", caption: "Skip reasons waiting for a rule" });

  b.push({ k: "h", level: 2, text: "Where the numbers come from", id: "provenance" });
  b.push({ k: "p", text: `The suite has ${model.catalog.total} checks in its catalog. Counts for each surface take, for every check, the newest recorded result for that platform surface; surfaces whose newest run is older than the rest, or that predate the current set of checks, are labelled recorded earlier. Numbers from different runs are therefore not strictly comparable.` });
  const prow: Cell[][] = [];
  for (const s of first) for (const sf of s.surfaces) prow.push([{ t: `${s.cfg.name}: ${sf.cfg.label}` }, { t: sf.runs.length === 0 ? "none" : sf.runs.map((r) => runRef(r)).join(", ") }, { t: sf.recordedEarlier ? `recorded earlier (${sf.earlierWhy.join("; ")})` : "current" }]);
  b.push({ k: "table", head: ["Surface", "Run folders used", "Currency"], rows: prow, cls: "counts" });
  b.push({ k: "p", text: `Other inputs: the vector manifests, exceptions, [interop ledger](interop/ledger.md), [pair matrix](interop/pair-matrix.md) and the \`core-advisory\` outputs in each run folder. Run folders present: ${model.runFolders.length}.` });
  return b;
}

// ---------- Markdown ----------

const mdCell = (c: Cell, i = 1): string => (c.t + (c.label && (i > 0 || c.kind) ? ` (${c.label})` : "")).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderMd(blocks: Block[]): string {
  const out: string[] = ["# Conformance at a glance", ""];
  const emit = (bl: Block, depth: number): void => {
    switch (bl.k) {
      case "h": out.push(`${"#".repeat(bl.level)} ${bl.text}`, ""); break;
      case "p": out.push(bl.text, ""); break;
      case "box": out.push(`> **${bl.title}**`, ...bl.items.map((i) => `> - ${i}`), ""); break;
      case "ul": out.push(...bl.items.map((i) => `- ${i}`), ""); break;
      case "table": {
        if (bl.caption) out.push(`*${bl.caption}*`, "");
        out.push(`| ${bl.head.join(" | ")} |`, `|${bl.head.map(() => "---").join("|")}|`, ...bl.rows.map((r) => `| ${r.map((c, i) => mdCell(c, i)).join(" | ")} |`), "");
        break;
      }
      case "details": out.push(`**${bl.summary}**`, ""); for (const x of bl.blocks) emit(x, depth + 1); break;
      case "legend": out.push("Cell words: " + bl.items.map((i) => `${CELL_WORD[i.kind].glyph} ${CELL_WORD[i.kind].word} (${CELL_WORD[i.kind].mean})`).join("; "), ""); break;
    }
  };
  for (const bl of blocks) emit(bl, 0);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------- HTML ----------

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string): string => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const CSS = `
:root{--bg:#fbfbf9;--fg:#1d2330;--mut:#566074;--card:#fff;--line:#d9dde5;--link:#0b5cad;
--ok-bg:#e3f3e6;--ok-fg:#14532d;--op-bg:#e8f1fb;--op-fg:#14437a;--df-bg:#fdf0d5;--df-fg:#6b3f00;--bad-bg:#fbe3e3;--bad-fg:#7f1d1d;
--na-bg:#eceef2;--na-fg:#3b4252;--nr-bg:#f1e9fb;--nr-fg:#46216e;--vm-bg:#e1f4f4;--vm-fg:#0b4f52;--no-bg:#fff;--no-fg:#566074}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#12151c;--fg:#e6e9f0;--mut:#a3adc2;--card:#1a1f2a;--line:#2f3748;--link:#7db7ff;
--ok-bg:#16351f;--ok-fg:#a8e6bb;--op-bg:#16304d;--op-fg:#b3d4fb;--df-bg:#3d2d0c;--df-fg:#f3d28f;--bad-bg:#4a1c1c;--bad-fg:#f6bcbc;
--na-bg:#262c38;--na-fg:#c5cbd8;--nr-bg:#33214a;--nr-fg:#d8c3f3;--vm-bg:#123a3c;--vm-fg:#a7e3e5;--no-bg:#1a1f2a;--no-fg:#a3adc2}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:1.7rem;margin:.4em 0}h2{font-size:1.3rem;margin:1.6em 0 .5em;border-bottom:1px solid var(--line);padding-bottom:.2em}h3{font-size:1.12rem;margin:1.4em 0 .4em}
a{color:var(--link)}code{font-size:.9em;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}
.box{border:1px solid var(--line);border-left:6px solid var(--link);background:var(--card);border-radius:6px;padding:.6em 1em;margin:1em 0}
.box.warn{border-left-color:#b7791f}.box h2{border:0;font-size:1.05rem;margin:.2em 0}.box ul{margin:.3em 0 .3em 1.1em;padding:0}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);margin:.6em 0}
th,td{border:1px solid var(--line);padding:.4em .6em;text-align:left;vertical-align:top}th{background:var(--na-bg);font-weight:600}
caption{caption-side:top;text-align:left;color:var(--mut);font-size:.9em;padding:.2em 0}
.sub{display:block;font-size:.82em;color:var(--mut);font-weight:400}
td.k{font-weight:600}td.k .sub{font-weight:400}
.k-agrees{background:var(--ok-bg);color:var(--ok-fg)}.k-agrees-open{background:var(--op-bg);color:var(--op-fg)}.k-differences{background:var(--df-bg);color:var(--df-fg)}
.k-unexplained{background:var(--bad-bg);color:var(--bad-fg)}.k-not-applicable{background:var(--na-bg);color:var(--na-fg)}.k-not-reached,.k-not-reachable{background:var(--nr-bg);color:var(--nr-fg)}
.k-version-mismatch{background:var(--vm-bg);color:var(--vm-fg)}.k-none{background:var(--no-bg);color:var(--no-fg);border-style:dashed}
.k .sub{color:inherit;opacity:.85}
.legend{display:flex;flex-wrap:wrap;gap:.5em;margin:.6em 0;padding:0;list-style:none}.legend li{border:1px solid var(--line);border-radius:6px;padding:.25em .6em;font-size:.9em}
details{border:1px solid var(--line);border-radius:6px;background:var(--card);margin:.6em 0;padding:.3em .8em}summary{cursor:pointer;font-weight:600;padding:.3em 0}
@media (max-width:720px){main{padding:12px 16px}
table.grid,table.grid tbody,table.grid tr,table.grid td{display:block;width:100%}table.grid thead{position:absolute;left:-9999px}
table.grid tr{margin:0 0 .8em;border:1px solid var(--line);border-radius:6px;overflow:hidden}table.grid td{border:0;border-top:1px solid var(--line)}
table.grid td:first-child{background:var(--na-bg);font-size:1.02em}table.grid td[data-label]:not(:first-child)::before{content:attr(data-label);display:block;font-size:.8em;font-weight:400;opacity:.8}
}
footer{margin-top:2em;color:var(--mut);font-size:.9em}
`;

export function renderHtml(blocks: Block[], runSet: string): string {
  const out: string[] = [];
  const emit = (bl: Block): void => {
    switch (bl.k) {
      case "h": out.push(`<h${bl.level} id="${esc(bl.id)}">${inline(bl.text)}</h${bl.level}>`); break;
      case "p": out.push(`<p>${inline(bl.text)}</p>`); break;
      case "box": out.push(`<section class="box ${bl.tone === "warn" ? "warn" : ""}"><h2>${esc(bl.title)}</h2><ul>${bl.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul></section>`); break;
      case "ul": out.push(`<ul>${bl.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); break;
      case "table": {
        const g = bl.cls === "grid";
        const head = bl.head;
        out.push(`<div class="tw"><table class="${bl.cls}">${bl.caption ? `<caption>${esc(bl.caption)}</caption>` : ""}<thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${bl.rows.map((r) => `<tr>${r.map((c, i) => {
          const cls = c.kind ? ` class="k k-${c.kind}"` : "";
          const lab = g && i > 0 ? ` data-label="${esc(head[i] ?? "")}"` : "";
          return `<td${cls}${lab}>${inline(c.t)}${c.label ? `<span class="sub">${esc(c.label)}</span>` : ""}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div>`);
        break;
      }
      case "details": out.push(`<details open><summary>${esc(bl.summary)}</summary>`); for (const x of bl.blocks) emit(x); out.push("</details>"); break;
      case "legend": out.push(`<ul class="legend">${bl.items.map((i) => `<li class="k k-${i.kind}"><strong>${esc(CELL_WORD[i.kind].glyph)} ${esc(CELL_WORD[i.kind].word)}</strong>: ${esc(CELL_WORD[i.kind].mean)}</li>`).join("")}</ul>`); break;
    }
  };
  for (const bl of blocks) emit(bl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="scripts/at-a-glance.ts (run set ${esc(runSet)})">
<title>Conformance at a glance</title>
<style>${CSS}</style></head>
<body><main>
<h1>Conformance at a glance</h1>
${out.join("\n")}
<footer>Draft proposal. Generated file; regenerate with <code>npm run at-a-glance</code>.</footer>
</main></body></html>
`;
}
