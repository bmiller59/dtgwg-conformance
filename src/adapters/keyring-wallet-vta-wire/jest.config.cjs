// SPDX-License-Identifier: Apache-2.0
// jest configuration for the keyring-wallet-vta-wire host: keyring-wallet's own jest configuration (its babel, module mapping and setup apply to
// its code), re-rooted at its core package and pointed at the host in this folder. Nothing is written to the wallet checkout.
const path = require("node:path");
const kwRoot = process.env.KW_ROOT || path.resolve("../keyring-wallet");
const core = path.join(kwRoot, "bifold/packages/core");
const base = require(path.join(core, "jest.config.js"));
module.exports = {
  ...base,
  rootDir: core,
  roots: [__dirname, core],
  testRegex: "(wire-host|resolver-check)\\.jest\\.ts$",
  testPathIgnorePatterns: [],
  testTimeout: 30 * 60 * 1000,
  modulePaths: [path.join(core, "node_modules"), path.join(kwRoot, "bifold/node_modules")],
  cacheDirectory: process.env.KW_JEST_CACHE || path.join(require("node:os").tmpdir(), "kw-vta-wire", "jest-cache"),
};
