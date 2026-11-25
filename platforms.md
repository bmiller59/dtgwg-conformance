# Platforms measured

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

A directory, in the order VTI, keyring-wallet, truststackers. It holds no figures: dated results are published separately and are not part of this repository. Platforms are reported separately, never added or averaged.

| Platform | Role in the authority order | GitHub | Adapter in this repository | Platform page (generated locally by `npm run regen`, not published) |
|---|---|---|---|---|
| VTI (verifiable-trust-infrastructure) | Most authoritative implementation after the specifications (anchor 1 of 2). Not built against the suite. | [OpenVTC/verifiable-trust-infrastructure](https://github.com/OpenVTC/verifiable-trust-infrastructure) (public) | `src/adapters/vti/` (live service, and in process against a VTC host in `src/adapters/vti/vtc-host/`), `src/adapters/vti-inprocess/` (agent handlers in process) and `src/adapters/vti-emit/` (VTI's own client builders, the sending side) | results/platforms/vti.md |
| keyring-wallet | Second anchor, after VTI. Not built against the suite. | [berkmancenter/keyring-wallet](https://github.com/berkmancenter/keyring-wallet) (public) | `src/adapters/keyring-wallet/`, `src/adapters/keyring-wallet-didcomm/` and `src/adapters/witness-server/` | results/platforms/keyring-wallet.md |
| keyring-wallet witness server, in-process host (group WIT) | Part of keyring-wallet (second anchor): the server the wallet's witness ceremony talks to, measured with its own handlers behind a stand-in carrier. Not built against the suite. | [berkmancenter/keyring-bifold](https://github.com/berkmancenter/keyring-bifold) (public), `packages/witness-server` | `src/adapters/witness-server/` (`launcher.ts`, `witness-host.ts`, `shim.ts`; the DIDComm adapter of the same folder is part of the keyring-wallet rows). Run `2026-11-19-witness` (bifold `7e14c5124`); not re-run on the final suite | results/platforms/keyring-wallet.md |
| truststackers (original) | Third: the original upstream, independent of the suite. | [TrustStackers/p2p-trust-stack](https://github.com/TrustStackers/p2p-trust-stack) (original repository, public); also [TrustStackers/utility-server](https://github.com/TrustStackers/utility-server) and [TrustStackers/agent-app](https://github.com/TrustStackers/agent-app) (public) | None reachable: the suite's adapter does not load against the original code (no Trust Task boundary upstream). | results/platforms/truststackers-original.md |

The reference adapter (`src/adapters/reference/`) is the suite checking itself, not a platform.

## Adding a platform


1. Write an adapter under `src/adapters/<name>/` (see `src/adapters/example-server/` for a starting point, and the walk-through [add a platform](docs/add-a-platform.md)).
2. Record a run in `<results dir>/runs/YYYY-MM-DD-<label>/` (the steps are in [CONTRIBUTING.md, recipe 2](CONTRIBUTING.md#2-record-a-run)).
3. Add a row to this table: role in the authority order, GitHub link (verified; write "not public" if unpublished or private, never guess), adapter path.
4. Add the platform and its surfaces to `results/at-a-glance.config.json`, write its platform header (what is measured: authority, independence, what the result does and does not show; how to run it) with a `<!-- generated:platform:<id> -->` block, and run `npm run regen`. No figure is typed by hand.
5. Add a `draft-issues/` folder to the run (drafts; none is filed without the project owner's say).

The review of the recorded differences is in [results/vector-review.md](results/vector-review.md). Back to the [repository README](README.md).
