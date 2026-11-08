#!/usr/bin/env bash
# Runs the collector against a fake docker CLI and fictional fixtures, then renders the email.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FX="$(mktemp -d)"
trap 'rm -rf "$FX"' EXIT

python3 "$HERE/make_fixture.py" "$FX" >/dev/null
mkdir -p "$FX/bin" "$FX/state"
ln -s "$HERE/fake_docker.py" "$FX/bin/docker"
printf 'PIXTAHA_CLIENT=Demo Client\nPIXTAHA_ENV=production\n' > "$FX/config.env"
export PATH="$FX/bin:$PATH" FAKE_DOCKER_DIR="$FX" PIXTAHA_STATE_DIR="$FX/state" PIXTAHA_CONFIG="$FX/config.env"

python3 "$REPO/collector/pixtaha_collector.py" sample >/dev/null
python3 "$REPO/collector/pixtaha_collector.py" sample >/dev/null
python3 "$REPO/collector/pixtaha_collector.py" report --out "$FX/payload.json" >/dev/null

python3 - "$FX/payload.json" <<'EOF'
import json, sys
p = json.load(open(sys.argv[1]))
raw = open(sys.argv[1]).read()
assert p["schema_version"] == "1.0"
assert "do-not-leak" not in raw, "secret env value leaked into payload"
ids = {a["id"] for a in p["attention"]}
for want in ("ports.public_database", "containers.unpinned", "n8n.failed_executions", "containers.restarts"):
    assert want in ids, want
n8n = {i["name"]: i for i in p["blocks"]["n8n"]["instances"]}
assert n8n["n8n-alpha"]["workflows_total"] == 12 and n8n["n8n-alpha"]["executions_ok_24h"] == 340
assert n8n["n8n-heavy"]["executions_failed_24h"] == 7
assert n8n["n8n-shared"]["workflows_total"] is None
assert "n8n-byid" in n8n, "n8n started from an image ID was not detected"
assert len(p["kpis"]["cpu_hourly_pct"]) == 24
print("payload ok:", p["status"]["overall"], len(p["attention"]), "attention items")
EOF
python3 "$HERE/test_alerts.py"
python3 "$HERE/test_live.py"
node "$REPO/email/render.js" "$FX/payload.json" "$FX/email.html" light
echo "all collector tests passed"
