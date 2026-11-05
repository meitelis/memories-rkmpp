#!/bin/bash
# Temporary IPv4 HTTPS response shaping; internal go-vod/DB traffic is excluded.
set -euo pipefail
container=${1:?Usage: bash scripts/test-v11-network.sh NEXTCLOUD_CONTAINER [HTTPS_PORT]}
port=${2:-443}
[[ $port =~ ^[0-9]+$ && $port -ge 1 && $port -le 65535 ]] || exit 2
pid=$(docker inspect -f '{{.State.Pid}}' "$container")
[[ $pid =~ ^[0-9]+$ && $pid -gt 0 ]] || exit 2
sudo -v
tcns() { sudo -n nsenter -t "$pid" -n tc "$@"; }
tcns qdisc show dev eth0 | grep -q '^qdisc noqueue ' || {
  echo 'Existing traffic control detected; leaving it untouched.' >&2; exit 2;
}
cleanup() {
  trap - EXIT
  if tcns qdisc show dev eth0 | grep -q '^qdisc htb 1:'; then
    tcns qdisc del dev eth0 root
  fi
  date -u
  tcns qdisc show dev eth0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
tcns qdisc add dev eth0 root handle 1: htb default 10
tcns class add dev eth0 parent 1: classid 1:10 htb rate 10000mbit ceil 10000mbit burst 128kb cburst 128kb quantum 15140
tcns class add dev eth0 parent 1: classid 1:20 htb rate 20mbit ceil 20mbit burst 128kb cburst 128kb quantum 15140
# Fixed latency avoids netem's independent per-packet jitter reordering TCP.
tcns qdisc add dev eth0 parent 1:20 handle 20: netem delay 80ms limit 1000
tcns filter add dev eth0 protocol ip parent 1: prio 1 u32 match ip sport "$port" 0xffff flowid 1:20
for profile in '20mbit 45' '800kbit 50' '4mbit 30' '80mbit 65'; do
  read -r rate seconds <<< "$profile"
  tcns class change dev eth0 parent 1: classid 1:20 htb rate "$rate" ceil "$rate" burst 128kb cburst 128kb quantum 15140
  printf '%s rate=%s duration=%ss\n' "$(date -u +%FT%TZ)" "$rate" "$seconds"
  sleep "$seconds"
  tcns -s class show dev eth0
done
