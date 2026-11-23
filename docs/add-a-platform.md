# Add a platform

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

A platform is connected to the suite through an adapter: a small program that turns "send these bytes, tell me what came back" into the platform's own calls. The suite never looks inside the platform. This page is the walk-through; the contract itself is [docs/04 section 4](04-suite-design.md#4-adapter-contract-built-typescript-types-client-and-example-server), and the rules a reviewer reads an adapter against are in [how to contribute](community/contributing.md#add-or-extend-an-adapter). Every task specification involved is draft.

## 1. Run the example adapter first

`src/adapters/example-server/server.ts` serves the suite's reference adapter over the wire. It is the model for your own adapter, and running it shows what a working adapter looks like from the runner's side:

```sh
nice -n 10 npm run suite -- --adapter 'stdio:node --experimental-strip-types --disable-warning=ExperimentalWarning src/adapters/example-server/server.ts stdio' --tier 1 --allow-effects reference-in-process --out results-local/stdio
```

## 2. Choose how the runner reaches your adapter

| `--adapter` | When to use it |
|---|---|
| `stdio:<command>` | Your adapter is a program. The runner starts it and exchanges one JSON-RPC message per line on its stdin and stdout; logs go to stderr. Works from any language. |
| `http:<url>` | Your adapter is already a running server. One JSON-RPC request per HTTP `POST`. |
| `module:<path>` | Your adapter is a TypeScript module in this repository exporting `createAdapter()`. |

Real adapters to learn from are in `src/adapters/`: `vti/` (a live service over HTTPS, as a module), `vti-inprocess/` and `keyring-wallet/` (a platform's code hosted by a launcher, over stdio). A TypeScript adapter can use the server helper in `src/adapter/server.ts` (`serveStdio`, `serveHttp`), as the example does.

## 3. Implement the methods

The runner calls `capabilities` and `provision` once, then `reset` and `setClock` before every vector, then `send` for each step, and `observe`, `snapshot` and `diff` to check what changed. Start with those. Every other method is optional and is used only when your `capabilities` answer declares it; a vector that needs something you did not declare is SKIP, which is an honest answer. The method table, with parameters and results, is [docs/04 section 4.2](04-suite-design.md#42-methods); wire examples are in [section 4.3](04-suite-design.md#43-wire-examples).

Three rules matter most:

- **Declare only what the platform does.** If the platform's clock cannot be set, declare `clockFree`, and the runner works on real time.
- **Never answer for the platform.** An adapter that manufactures an outcome measures itself, not the platform.
- **Give evidence for "not offered".** A task the platform does not offer is declared in `notOffered` with a file and line at a named commit of the platform.

## 4. Run it and read every result that is not a PASS

```sh
nice -n 10 npm run suite -- --adapter 'stdio:<your command>' --tier 1 --out results-local/my-platform
```

Leave out `--allow-effects` unless the platform instance is disposable. Read `results-local/my-platform/results.json`: for every FAIL, SKIP and CLARIFY, the reason says why ([reading results](reading-results.md)). A FAIL may be the platform, the vector, the specification text or your adapter; [how to contribute](community/contributing.md#classify-a-failure-a-b-c-or-d) says how to tell which. To run the other vector families and channels, see [CONTRIBUTING.md, recipe 1](../CONTRIBUTING.md#1-run-the-suite-against-your-platform).

## 5. Propose it

1. Put the adapter in `src/adapters/<name>/`, with the `// SPDX-License-Identifier: Apache-2.0` header and a header comment listing every environment variable it reads.
2. Add a row for the platform to the [adapter table in CONTRIBUTING.md](../CONTRIBUTING.md#adapters-and-their-environment) and to [platforms.md](../platforms.md#adding-a-platform), which also lists the steps for a platform whose runs are recorded.
3. Add the folder to the README's folder overview (a test checks every adapter folder is named there).
4. Run `npm run typecheck` and `nice -n 10 npm test`, sign off each commit (`git commit -s`) and open one pull request for the adapter.

Measure the original platform at a named commit or release, and report each platform separately. If you would like help, say which platform you would connect in a discussion, or on [first issue 3](maintainers/first-issues/03-contribute-a-platform-adapter.md) once it is open.
