// SPDX-License-Identifier: Apache-2.0
// Mechanical part of the hand review for registry promotion (docs/33 section 3): checks that a human would otherwise do by opening the
// task-force text. It verifies, for one vector, against the Trust Tasks clone at the commit the vector's tfRef names:
//   tf-spec       the cited specification exists there with status draft (or main for a non-spec document)
//   cite-lines    every `SPEC.md:<n>` / `SPEC.md:<n>-<m>` cite is a line of SPEC.md at that commit; where the same string says "item k" or
//                 "items k and l" the cited line starts with that item number
//   policy        a title "(recipient REQUIRED[, proof REQUIRED])" and a "isProofRequired=..., isRecipientRequired=..." spec string agree with
//                 the specification's front matter (parties / proofRequirement)
// It does not decide whether the vector may gate: a human reads the template and a sample (docs/33), and every thin vector in full.
export type Git = (commit: string, path: string) => string | null;

export interface ReviewVector { id: string; title: string; spec: string[]; tfRef: { repoPath: string; commit: string; status: string } }
export interface ReviewRow { id: string; problems: string[]; manual: string[]; thin: boolean }

/** A very small front-matter reader (no YAML library in the suite): quoted or bare scalars, `- role:` lists at any indent, and both
 *  `proofRequirement: {requirement}` and `proofRequirement: {request, response}` forms (the request side is what a consumer enforces). */
export function frontMatter(text: string): { status: string | null; recipient: string | null; proof: string | null } {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const fm = (m?.[1] ?? "").replace(/"/g, "").replace(/'/g, "");
  const status = /^status:\s*(\S+)/m.exec(fm)?.[1] ?? null;
  let recipient: string | null = null;
  const parties = /^parties:\n((?:[ -].*\n?)*)/m.exec(fm + "\n")?.[1] ?? "";
  for (const block of parties.split(/^\s*- /m)) {
    if (/member:\s*recipient\b/.test(block)) recipient = /requirement:\s*(\w+)/.exec(block)?.[1] ?? null;
  }
  const proof = /^proofRequirement:\n\s+(?:requirement|request):\s*(\w+)/m.exec(fm)?.[1] ?? null;
  return { status, recipient, proof };
}

/** Cited SPEC.md line numbers of one spec string, as ranges. A bare "SPEC.md 7.2 item 2" (a section reference) cites no line. */
export function citedLines(s: string): number[] {
  const out: number[] = [];
  const re = /SPEC\.md:(\d+)(?:-(\d+))?((?:,\s*(?:and\s*)?:?\d+(?:-\d+)?)*)/g;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    out.push(Number(m[1]));
    if (m[2] !== undefined) out.push(Number(m[2]));
    for (const x of (m[3] ?? "").matchAll(/(\d+)(?:-(\d+))?/g)) { out.push(Number(x[1])); if (x[2] !== undefined) out.push(Number(x[2])); }
  }
  return out;
}

/** Item numbers a string names ("7.2 item 5", "7.2 items 5 and 7", "7.2 item 2"). */
export function itemNumbers(s: string): number[] {
  const m = /\b7\.2 items?\s+(\d+(?:(?:,|\s+and)\s*\d+)*)/.exec(s);
  return m === null ? [] : [...m[1]!.matchAll(/\d+/g)].map((x) => Number(x[0]));
}

export function reviewVector(v: ReviewVector, git: Git): ReviewRow {
  const problems: string[] = [];
  const manual: string[] = [];
  const specText = git(v.tfRef.commit, v.tfRef.repoPath);
  if (specText === null) problems.push(`tf-spec: ${v.tfRef.repoPath} not at ${v.tfRef.commit.slice(0, 9)}`);
  const fm = specText === null ? null : frontMatter(specText);
  if (fm !== null && v.tfRef.status === "draft" && fm.status !== "draft") problems.push(`tf-spec: status ${fm.status}, tfRef says draft`);
  const spec = git(v.tfRef.commit, "SPEC.md");
  const lines = spec === null ? [] : spec.split("\n");
  for (const s of v.spec) {
    const cited = citedLines(s);
    if (cited.length > 0 && spec === null) problems.push("cite-lines: SPEC.md not readable at the commit");
    const nums = new Set(citedLines(s).length === 0 ? [] : [...s.matchAll(/SPEC\.md:(\d+)/g)].map((x) => Number(x[1])).concat([...s.matchAll(/,\s*(?:and\s*)?:?(\d+)/g)].map((x) => Number(x[1]))).filter((n) => n > 100));
    for (const n of nums) {
      const l = lines[n - 1];
      if (l === undefined || l.trim() === "") problems.push(`cite-lines: SPEC.md:${n} is not a line at that commit`);
    }
    const items = itemNumbers(s);
    if (items.length > 0 && /SPEC\.md:\d+/.test(s)) {
      const starts = [...nums].map((n) => Number(/^(\d+)\.\s/.exec(lines[n - 1] ?? "")?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
      if (starts.length > 0 && !items.some((i) => starts.includes(i))) problems.push(`cite-lines: ${s.slice(0, 40)}: item ${items.join("/")} not at the cited line(s) (found item ${starts.join("/")})`);
      if (starts.length === 0) manual.push(`cite not an item line: ${s.slice(0, 40)}`);
    }
  }
  const claim = /\(recipient REQUIRED(, proof REQUIRED)?\)/.exec(v.title);
  if (claim !== null && fm !== null) {
    if (fm.recipient !== "REQUIRED") problems.push(`policy: title says recipient REQUIRED, front matter says ${fm.recipient}`);
    if (claim[1] !== undefined && fm.proof !== "REQUIRED") problems.push(`policy: title says proof REQUIRED, front matter says ${fm.proof}`);
  }
  for (const s of v.spec) {
    const m = /isProofRequired=(true|false), isRecipientRequired=(true|false)/.exec(s);
    if (m !== null && fm !== null) {
      if ((m[1] === "true") !== (fm.proof === "REQUIRED")) problems.push(`policy: isProofRequired=${m[1]}, front matter proof ${fm.proof}`);
      if ((m[2] === "true") !== (fm.recipient === "REQUIRED")) problems.push(`policy: isRecipientRequired=${m[2]}, front matter recipient ${fm.recipient}`);
    }
  }
  // thin: fewer than three spec strings, or no string that states a rule with a numbered item
  const thin = v.spec.length < 4 || !v.spec.some((s) => itemNumbers(s).length > 0 || /\b8\.\d\b/.test(s));
  return { id: v.id, problems, manual, thin };
}
