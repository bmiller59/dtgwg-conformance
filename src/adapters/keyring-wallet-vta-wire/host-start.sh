#!/bin/bash
# start the wallet's wire host in the background; pid in run-tmp/host.pid, URL in run-tmp/host.url
W=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)
. "${WIRE_ENV:-$W/src/adapters/keyring-wallet-vta-wire/wire-env.sh}"
cd "$W" || exit 1
: > run-tmp/host.url
KW_WIRE_HOST_URL_FILE=$W/run-tmp/host.url KW_WIRE_TRACE=${KW_WIRE_TRACE:-$W/run-tmp/wire-trace.jsonl} setsid nohup node --experimental-strip-types --disable-warning=ExperimentalWarning src/adapters/keyring-wallet-vta-wire/wire-host-up.ts > run-tmp/host.log 2>&1 &
echo $! > run-tmp/host.pid
for i in $(seq 1 100); do [ -s run-tmp/host.url ] && break; sleep 3; done
cat run-tmp/host.url; echo
