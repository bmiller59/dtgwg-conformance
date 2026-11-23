// SPDX-License-Identifier: Apache-2.0
// The reference approver reads a community's https service endpoints: a port is accepted (a deployed community on a non-default port), userinfo, other schemes and whitespace are not.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { httpsEndpoint } from "../src/adapters/reference/oob-approver.ts";

describe("reference approver: https endpoint reading", () => {
  it("accepts https endpoints, with or without a port or path", () => {
    for (const e of ["https://community.example", "https://community.example/v1", "https://community.example:8443", "https://community.example:8443/v1?x=1", "HTTPS://Community.Example/#f"]) assert.equal(httpsEndpoint(e), e);
  });
  it("refuses a non-https scheme, userinfo, an empty authority, whitespace and a non-string", () => {
    for (const e of ["http://community.example", "https://user@community.example", "https://", "https:///v1", "https://a b.example", "did:web:x", 7, undefined, null]) assert.equal(httpsEndpoint(e), undefined);
  });
});
