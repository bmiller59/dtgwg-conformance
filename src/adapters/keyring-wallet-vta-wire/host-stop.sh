#!/bin/bash
W=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)
[ -s "$W/run-tmp/host.pid" ] && kill -TERM "$(cat "$W/run-tmp/host.pid")" 2>/dev/null
exit 0
