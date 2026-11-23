// SPDX-License-Identifier: Apache-2.0
// jest configuration for the keyring-wallet-didcomm host: the shim adapter's configuration, pointed at the entry in this folder.
const path = require("node:path");
const base = require("../keyring-wallet/jest.config.cjs");
module.exports = {
  ...base,
  roots: [__dirname, path.join(__dirname, "../keyring-wallet"), base.rootDir],
  testRegex: "kw-didcomm-host\\.jest\\.ts$",
  cacheDirectory: process.env.KW_JEST_CACHE || path.join(require("node:os").tmpdir(), "kw-didcomm-adapter", "jest-cache"),
};
