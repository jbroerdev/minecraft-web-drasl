#!/bin/bash
set -euo pipefail
umask 077
mkdir -p /data/launcher /data/proxy
if [ ! -f /data/launcher/gateway-secret ]; then
  node -e "require('fs').writeFileSync('/data/launcher/gateway-secret',require('crypto').randomBytes(32).toString('hex'),{mode:0o600})"
fi
if [ ! -f /data/proxy/config.yml ]; then
  cp -R /app/deploy/templates/. /data/proxy/
fi
mkdir -p /data/proxy/plugins/DraslLogin
cp /app/deploy/templates/plugins/*.jar /data/proxy/plugins/
key=$(cat /data/launcher/gateway-secret)
printf "verify_url: 'http://127.0.0.1:8790/api/gateway/verify'\ngateway_secret: '%s'\n" "$key" > /data/proxy/plugins/DraslLogin/config.yml
node /app/launcher/server.mjs &
node_pid=$!
cd /data/proxy
java -Xms128m -Xmx512m -jar /app/deploy/gateway/BungeeCord.jar &
java_pid=$!
cleanup() { kill "$node_pid" "$java_pid" 2>/dev/null || true; wait "$node_pid" "$java_pid" 2>/dev/null || true; }
trap cleanup EXIT TERM INT
wait -n "$node_pid" "$java_pid"
