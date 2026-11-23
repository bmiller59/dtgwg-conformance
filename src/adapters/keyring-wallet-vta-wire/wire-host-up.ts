// SPDX-License-Identifier: Apache-2.0
// Start the wallet's wire host once for a whole run and keep it up; writes its URL to the file named by KW_WIRE_HOST_URL_FILE and stops on SIGTERM or SIGINT.
//   KW_WIRE_HOST_URL_FILE=<path> node --experimental-strip-types src/adapters/keyring-wallet-vta-wire/wire-host-up.ts
import { writeFileSync } from "node:fs";
import { startHost } from "./host-control.ts";

const file = process.env.KW_WIRE_HOST_URL_FILE;
if (file === undefined || file === "") { console.error("KW_WIRE_HOST_URL_FILE is not set"); process.exit(2); }
const host = await startHost();
writeFileSync(file, host.url);
console.error(`wire host up: ${host.url} (wallet ${host.walletDid})`);
const down = (): void => { void host.stop().then(() => process.exit(0)); };
process.on("SIGTERM", down);
process.on("SIGINT", down);
host.child.on("exit", () => process.exit(1));
