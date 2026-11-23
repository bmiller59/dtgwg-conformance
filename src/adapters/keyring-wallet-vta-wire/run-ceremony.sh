#!/bin/bash
# run scenarios of the wire row: run-ceremony.sh <out dir> <scenario id>...   (host already up: host-start.sh)
# FC-KVC names its slots E (the executor, V) and K1 (the approver, K): WIRE_SLOT_K=K1 WIRE_SLOT_V=E
W=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)
. "${WIRE_ENV:-$W/src/adapters/keyring-wallet-vta-wire/wire-env.sh}"
export KW_WIRE_HOST_URL=$(cat "$W/run-tmp/host.url")
OUT=$1; shift
S=(); for i in "$@"; do S+=(--scenario "$i"); done
L="node --experimental-strip-types --disable-warning=ExperimentalWarning $W/src/adapters/keyring-wallet-vta-wire/launcher.ts"
cd "$W" && nice -n 10 npm run -s ceremony -- --participant "${WIRE_SLOT_K:-K}=stdio:$L --role K" --participant "${WIRE_SLOT_V:-V}=stdio:$L --role ${WIRE_ROLE_V:-V}" "${S[@]}" --reuse --out "$OUT"
