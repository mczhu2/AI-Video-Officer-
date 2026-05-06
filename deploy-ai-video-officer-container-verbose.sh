#!/usr/bin/env bash
set -euo pipefail

PACKAGE=/home/admin/app/ai-video-officer-package.tgz
CONTAINER=ai-video-officer
NETWORK=ai-video-officer-net
HOST_PORT=13001
CONTAINER_PORT=13001
ENV_FILE=/home/admin/.config/trtc-interview.env

test -f "$PACKAGE"
test -f "$ENV_FILE"

IMAGE=$(grep '^docker_url=' "$PACKAGE" | head -n1 | cut -d= -f2-)
test -n "$IMAGE"
echo "image=$IMAGE"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"
docker pull "$IMAGE"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --env-file "$ENV_FILE" \
  -p 127.0.0.1:${HOST_PORT}:${CONTAINER_PORT} \
  "$IMAGE"

for i in {1..30}; do
  echo "check #$i"
  curl -sS -o /dev/null -w "${HOST_PORT} / -> %{http_code}\n" \
    "http://127.0.0.1:${HOST_PORT}/" || true
  curl -sS -o /dev/null -w "${HOST_PORT} /api/health -> %{http_code}\n" \
    "http://127.0.0.1:${HOST_PORT}/api/health" || true
  curl -ksS -o /dev/null -w "8443 /api/health -> %{http_code}\n" \
    "https://127.0.0.1:8443/api/health" || true

  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null && \
     curl -kfsS "https://127.0.0.1:8443/api/health" >/dev/null; then
    echo "deploy ok"
    exit 0
  fi

  sleep 2
done

docker logs --tail 100 "$CONTAINER" || true
echo "--- nginx status ---"
systemctl status nginx --no-pager || true
echo "--- nginx error log ---"
tail -n 50 /var/log/nginx/error.log 2>/dev/null || true
echo "health check failed"
exit 1
