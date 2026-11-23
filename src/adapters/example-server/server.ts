// SPDX-License-Identifier: Apache-2.0
// Example out-of-process adapter: wraps the in-process reference adapter and serves it over the wire
// contract of docs/04-suite-design.md section 4. It shows what an implementation's own adapter server
// does, and the test suite runs the whole vector set through it.
//
//   node --experimental-strip-types src/adapters/example-server/server.ts stdio [options]
//   node --experimental-strip-types src/adapters/example-server/server.ts http --port 8080 [options]
//
// Options: --attested            serve the Tier 2 behaviour (default Tier 1)
//          --mutant a,b          apply the named reference mutants (to watch vectors fail)
//          --no-vrc              serve no VRC ceremony task
//          --no-witness-share    serve no vrc/relationships/witness-share task
//          --no-dtg              serve no 3b-DTG task (task-consent, credential-exchange; the TC and CEX vectors are SKIP)
//          --no-ceremony         serve no ceremony-document family (the CER vectors are SKIP)
//          --cosign              a begin does not count as the proposer's approval (declares ceremony.proposerApproves false)
//          --status[=C]          offer a status task (declares ceremony.status); C is the hold's continuation: proceed (default), resubmit or omit
//          --clock-free          model an implementation whose clock cannot be set (declares clockFree)
//          --window M,S,H        enforce and advertise this acceptance window in seconds: max age, skew, expiry horizon
//          --no-https            declare only the in-process binding (the BND vectors are SKIP)
//          --host H --port N     http only; the port is printed as "listening http://H:N/" on stdout
//
// Essential governance (docs/04 section 19). Every adapter states its platform's E in `capabilities.governance.essential`, from
// evidence: the authority set (the `principals` whose role is `consent.approverSet`, as harness actor tokens `$A`, `$X` ... where
// the harness can act as them) and `consent.minApprovals`, with `source` (`platform-config`, `harness-configured`, `fixed-rule`) and
// `evidence` (a repository-relative file and line at a commit, or a setting name). Where E cannot be read, state it and say why:
//   governance: { essential: { source: "unreadable", reason: "<why: for example, the adapter reads none of the configuration>" } }
// Stating nothing is read as unreadable with a generic reason. This server serves the reference, which states its own E
// (authority set $A and $X, k = 2, from its configuration); the harness checks any declared E against behaviour (the honesty check).
import { ReferenceAdapter } from "../reference/reference.ts";
import { serveHttp, serveStdio } from "../../adapter/server.ts";

function parse(argv: string[]): { mode: string; port: number; host: string; attested: boolean; mutants: string[]; vrc: boolean; witnessShare: boolean; https: boolean; ceremony: boolean; dtg: boolean; cosign: boolean; status: boolean; clockFree: boolean; window: { maxAgeSeconds: number; clockSkewSeconds: number; expiryHorizonSeconds: number } | undefined; statusContinuation: "proceed" | "resubmit" | "omit" } {
  const [mode, ...rest] = argv;
  if (mode !== "stdio" && mode !== "http") throw new Error("usage: server.ts stdio|http [--port N] [--host H] [--attested] [--mutant a,b] [--no-vrc] [--no-witness-share] [--no-ceremony] [--no-dtg] [--cosign] [--status[=proceed|resubmit|omit]] [--no-https] [--clock-free] [--window M,S,H]");
  const o = { mode, port: 0, host: "127.0.0.1", attested: false, mutants: [] as string[], vrc: true, witnessShare: true, https: true, ceremony: true, dtg: true, cosign: false, status: false, clockFree: false, window: undefined as { maxAgeSeconds: number; clockSkewSeconds: number; expiryHorizonSeconds: number } | undefined, statusContinuation: "proceed" as "proceed" | "resubmit" | "omit" };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const next = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--port") o.port = Number(next());
    else if (a === "--host") o.host = next();
    else if (a === "--attested") o.attested = true;
    else if (a === "--mutant") o.mutants = next().split(",").filter((m) => m !== "");
    else if (a === "--no-vrc") o.vrc = false;
    else if (a === "--no-witness-share") o.witnessShare = false;
    else if (a === "--no-ceremony") o.ceremony = false;
    else if (a === "--no-dtg") o.dtg = false;
    else if (a === "--cosign") o.cosign = true;
    else if (a === "--status" || a.startsWith("--status=")) {
      o.status = true;
      const c = a.slice("--status=".length);
      if (a !== "--status") {
        if (c !== "proceed" && c !== "resubmit" && c !== "omit") throw new Error("--status takes proceed, resubmit or omit");
        o.statusContinuation = c;
      }
    } else if (a === "--no-https") o.https = false;
    else if (a === "--clock-free") o.clockFree = true;
    else if (a === "--window") {
      const [m, k, h] = next().split(",").map(Number);
      if (![m, k, h].every((n) => Number.isInteger(n))) throw new Error("--window takes M,S,H in whole seconds");
      o.window = { maxAgeSeconds: m!, clockSkewSeconds: k!, expiryHorizonSeconds: h! };
    }
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function main(): Promise<void> {
  const o = parse(process.argv.slice(2));
  const adapter = new ReferenceAdapter({ attested: o.attested, mutants: o.mutants, vrc: o.vrc, witnessShare: o.witnessShare, https: o.https, ceremony: o.ceremony, dtg: o.dtg, proposerApproves: !o.cosign, ceremonyStatus: o.status, statusContinuation: o.statusContinuation, clockFree: o.clockFree, ...(o.window === undefined ? {} : { window: o.window }), ...(o.attested && o.mutants.length === 0 ? { name: "reference-attested" } : {}) });
  if (o.mode === "stdio") {
    await serveStdio(adapter, process.stdin, process.stdout);
    return;
  }
  const server = await serveHttp(adapter, o.port, o.host);
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : o.port;
  console.log(`listening http://${o.host}:${port}/`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(2);
});
