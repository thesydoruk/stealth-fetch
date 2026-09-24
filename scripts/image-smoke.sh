#!/usr/bin/env bash
# Boot a service image and fetch a local page through its real Chrome.
#
# Usage: scripts/image-smoke.sh <image> <port>
#
# /health alone only proves node started. The page below fills in its text from
# JavaScript, so the marker comes back only when Chrome launched under Xvfb and
# rendered it.
set -euo pipefail

image="$1"
port="$2"
page_port=8765
marker="rendered-by-chrome"
name="smoke-${port}"

site="$(mktemp -d)"
cat >"${site}/index.html" <<HTML
<!doctype html>
<title>smoke</title>
<p id="out">static</p>
<script>document.getElementById("out").textContent = "${marker}";</script>
HTML

python3 -m http.server "${page_port}" --bind 127.0.0.1 --directory "${site}" >/dev/null 2>&1 &
http_pid=$!

cleanup() {
  status=$?
  if [ "${status}" -ne 0 ]; then
    echo "--- ${name} logs ---" >&2
    docker logs "${name}" >&2 || true
  fi
  docker rm -f "${name}" >/dev/null 2>&1 || true
  kill "${http_pid}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT

# Host networking lets Chrome inside the container reach the page server above.
docker run -d --name "${name}" --network host --shm-size 1g -e PORT="${port}" "${image}" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${port}/health"
echo

response="$(curl -sS --max-time 150 -X POST "http://127.0.0.1:${port}/fetch" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"http://127.0.0.1:${page_port}/\",\"skipCache\":true,\"timeoutMs\":120000}")"

if ! jq -e --arg marker "${marker}" '.ok == true and (.html | contains($marker))' <<<"${response}" >/dev/null; then
  echo "Fetch did not return the rendered page:" >&2
  jq 'del(.html)' <<<"${response}" >&2 || echo "${response}" >&2
  exit 1
fi

echo "${image}: rendered the page through Chrome"
