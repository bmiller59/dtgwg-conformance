# Environment for the keyring-wallet-vta-wire row (source it). Paths name this run's dirs; override any of them.
umask 002
W=${W:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)}
I=${I:?set I to the kit copy that holds .vta/ (admin.json, vta-did2.txt, mediator-did2.txt)}
export KW_ROOT=${KW_ROOT:?set KW_ROOT to the keyring-wallet checkout}
export KW_JEST_CACHE=${KW_JEST_CACHE:-$W/run-tmp/jest-cache} TMPDIR=${TMPDIR:-$W/run-tmp}
export KW_WIRE_VTA_DID=${KW_WIRE_VTA_DID:-$(cat "$I/.vta/vta-did2.txt")}
export KW_WIRE_MEDIATOR_DID=${KW_WIRE_MEDIATOR_DID:-$(cat "$I/.vta/mediator-did2.txt")}
export KW_WIRE_VTA_URL=${KW_WIRE_VTA_URL:-http://localhost:18810}
export KW_WIRE_ADMIN_FILE=${KW_WIRE_ADMIN_FILE:-$I/.vta/admin.json}
export KW_WIRE_CLEAN_ACL=${KW_WIRE_CLEAN_ACL:-1}
export KW_WIRE_INFO=${KW_WIRE_INFO:-'{"walletCommit":"969963df","vtaImage":"vta-buildathon:26d0da81","mediatorImage":"mediator-buildathon:e6e2c636"}'}
