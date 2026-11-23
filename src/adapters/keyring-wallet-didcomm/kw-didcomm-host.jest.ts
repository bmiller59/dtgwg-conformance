/**
 * SPDX-License-Identifier: Apache-2.0
 *
 * @jest-environment node
 *
 * keyring-wallet-didcomm host: the entry jest runs. It selects the real-agent mode of the shim host and loads it, so the control plane
 * (triggers, observes, clock, reset) is the shim adapter's own code, now pointed at a real Credo agent behind a real DIDComm endpoint.
 * Do not run it directly; run launcher.ts.
 */
// @ts-nocheck
process.env.KW_REAL_AGENT = require("node:path").join(__dirname, "kw-didcomm-agent.ts");
require("../keyring-wallet/kw-host.jest.ts");
