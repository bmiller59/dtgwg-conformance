#!/bin/bash
# one-shot resolver check (resolver-check.jest.ts) against a live mediator; env: KW_WIRE_MEDIATOR_DID, KW_WIRE_OUT
umask 002
W=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)
export KW_ROOT=${KW_ROOT:?set KW_ROOT to the keyring-wallet checkout} KW_JEST_CACHE=$W/run-tmp/jest-cache TMPDIR=$W/run-tmp
: > "$KW_WIRE_OUT"
cd "$KW_ROOT/bifold/packages/core" && timeout 900 nice -n 10 "$KW_ROOT/bifold/node_modules/.bin/jest" --config "$W/src/adapters/keyring-wallet-vta-wire/jest.config.cjs" --runInBand --watchman=false --forceExit --testPathPattern resolver-check
