#!/usr/bin/env bash
# Exposes local Courier and the demo shop on temporary public HTTPS URLs (Cloudflare quick tunnels, no account),
# writes them into .env, and restarts the apps. Then add "$COURIER_URL/mcp" as a custom connector in Claude.
#
#   ./scripts/tunnel.sh        (Ctrl+C stops tunnels and apps)
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cloudflared >/dev/null || { echo "Install cloudflared first: brew install cloudflared"; exit 1; }

LOGDIR="$(mktemp -d)"
# HTTP/2 avoids UDP/QUIC idle disconnects observed on the demo network.
# Override with CLOUDFLARED_PROTOCOL=auto if the network supports QUIC reliably.
TUNNEL_PROTOCOL="${CLOUDFLARED_PROTOCOL:-http2}"
cloudflared tunnel --no-autoupdate --protocol "$TUNNEL_PROTOCOL" --url http://127.0.0.1:4000 >"$LOGDIR/courier.log" 2>&1 &
P1=$!
cloudflared tunnel --no-autoupdate --protocol "$TUNNEL_PROTOCOL" --url http://127.0.0.1:4100 >"$LOGDIR/store.log" 2>&1 &
P2=$!
trap 'kill $P1 $P2 ${P3:-} 2>/dev/null || true' EXIT

url_of() { for _ in $(seq 1 40); do u=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$1" | head -1 || true); [ -n "$u" ] && { echo "$u"; return; }; sleep 0.5; done; echo ""; }
COURIER_URL=$(url_of "$LOGDIR/courier.log")
STORE_URL=$(url_of "$LOGDIR/store.log")
[ -n "$COURIER_URL" ] && [ -n "$STORE_URL" ] || { echo "Tunnels did not come up; see $LOGDIR"; exit 1; }

touch .env
grep -v -E '^(COURIER_URL|STORE_URL)=' .env > .env.tmp || true
{ cat .env.tmp; echo "COURIER_URL=$COURIER_URL"; echo "STORE_URL=$STORE_URL"; } > .env
rm -f .env.tmp

pkill -f "tsx.*apps/(courier|store)" 2>/dev/null || true
npm start &
P3=$!
sleep 4
cat <<MSG

  Courier : $COURIER_URL
  Juniper Records: $STORE_URL
  Claude connector URL (Settings → Connectors → Add custom connector):

      $COURIER_URL/mcp

  Note: these URLs change every time you run this script, and PayPal's Log in return URL must match
  $COURIER_URL/auth/paypal/callback when using real sandbox credentials.
MSG
wait $P3
