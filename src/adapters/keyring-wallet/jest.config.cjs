// SPDX-License-Identifier: Apache-2.0
// jest configuration for the keyring-wallet adapter host: keyring-wallet's own jest configuration (so its babel, module mapping and
// setup apply to its code), re-rooted at its core package and pointed at the host file in this folder. Nothing is written to the
// wallet checkout: the cache goes to KW_JEST_CACHE.
const path = require("node:path");
const kwRoot = process.env.KW_ROOT || path.resolve("../keyring-wallet");
const core = path.join(kwRoot, "bifold/packages/core");
const base = require(path.join(core, "jest.config.js"));
module.exports = {
  ...base,
  rootDir: core,
  roots: [__dirname, core],
  testRegex: "kw-host\\.jest\\.ts$",
  testPathIgnorePatterns: [],
  testTimeout: 6 * 60 * 60 * 1000,
  modulePaths: [path.join(core, "node_modules"), path.join(kwRoot, "bifold/node_modules")],
  cacheDirectory: process.env.KW_JEST_CACHE || path.join(require("node:os").tmpdir(), "kw-adapter", "jest-cache"),
};
