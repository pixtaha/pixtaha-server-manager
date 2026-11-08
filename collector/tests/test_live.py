#!/usr/bin/env python3
"""Live dashboard tests (collector 1.2.0): the live push, re-check -> refresh report, refresh reports never
touch the daily baseline, DOCKER-USER allowlists, ignored backup folders. Fictional data only."""
import http.server
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
COLLECTOR = os.path.join(HERE, "..", "pixtaha_collector.py")
TOKEN = "test-token-do-not-leak"
ANON = "anon-key-for-tests"
got = []
REPLY = {"recheck": False}


class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        got.append({"path": self.path, "apikey": self.headers.get("apikey"), "auth": self.headers.get("Authorization"),
                    "body": json.loads(body)})
        if self.path.endswith("/sm_live"):
            out = {"ok": True, "recheck": REPLY["recheck"]}
            REPLY["recheck"] = False
        else:
            out = {"stored": True}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


srv = http.server.HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

fx = tempfile.mkdtemp()
subprocess.run([sys.executable, os.path.join(HERE, "make_fixture.py"), fx], check=True, stdout=subprocess.DEVNULL)
os.makedirs(os.path.join(fx, "bin"))
os.makedirs(os.path.join(fx, "state"))
os.symlink(os.path.join(HERE, "fake_docker.py"), os.path.join(fx, "bin", "docker"))
with open(os.path.join(fx, "config.env"), "w") as f:
    f.write("PIXTAHA_CLIENT=Demo Client\nPIXTAHA_ENV=demo\nPIXTAHA_HOSTNAME=demo-host\n"
            "PIXTAHA_WEBHOOK_URL=http://127.0.0.1:1/webhook/server-daily-report\n"
            "PIXTAHA_REPORT_TOKEN=%s\nPIXTAHA_ALERT_DOMAINS=off\n"
            "PIXTAHA_LIVE_URL=http://127.0.0.1:%d/\nPIXTAHA_LIVE_KEY=%s\n" % (TOKEN, port, ANON))
env = dict(os.environ, PATH=os.path.join(fx, "bin") + ":" + os.environ["PATH"], FAKE_DOCKER_DIR=fx,
           PIXTAHA_STATE_DIR=os.path.join(fx, "state"), PIXTAHA_CONFIG=os.path.join(fx, "config.env"))


def run(*args, timeout=120):
    out = subprocess.run([sys.executable, COLLECTOR] + list(args), env=env, capture_output=True, text=True, timeout=timeout)
    assert out.returncode == 0, out.stdout + out.stderr
    return out.stdout


def wait_for(path, n, secs=90):
    end = time.time() + secs
    while time.time() < end:
        if sum(1 for g in got if g["path"].endswith(path)) >= n:
            return
        time.sleep(0.2)
    raise AssertionError("timed out waiting for %s" % path)


# 1. one live push: right endpoint, headers, fields; no secrets
run("live", "--once")
g = got[-1]
assert g["path"] == "/rest/v1/rpc/sm_live", g["path"]
assert g["apikey"] == ANON and g["auth"] == "Bearer " + ANON
assert g["body"]["p_token"] == TOKEN
p = g["body"]["p"]
for k in ("hostname", "collector", "cpu", "ram", "ram_mb", "ram_total_mb", "disk", "disk_gb", "disk_total_gb", "boot_at", "running", "total"):
    assert k in p, k
assert p["hostname"] == "demo-host" and p["total"] >= p["running"] > 0
assert TOKEN not in json.dumps(p) and "do-not-leak" not in json.dumps(p), "secret leaked into the live snapshot"
assert all(set(c) == {"n", "s"} for c in p["containers"])

# 2. the hub asks for a re-check: the next push starts a refresh report (no systemd here: detached process)
REPLY["recheck"] = True
run("live", "--once")
wait_for("/sm_push_report", 1)
r = [x for x in got if x["path"].endswith("/sm_push_report")][-1]
rep = r["body"]["p"]
assert r["body"]["p_token"] == TOKEN and r["apikey"] == ANON
assert rep["report"]["type"] == "refresh" and rep["report"]["id"].startswith("demo-host-refresh-"), rep["report"]
assert "do-not-leak" not in json.dumps(rep), "secret leaked into the refresh report"
time.sleep(0.5)

# 3. refresh reports never write the daily baseline
assert not os.path.exists(os.path.join(fx, "state", "state.json")), "refresh report wrote state.json"
assert not os.path.exists(os.path.join(fx, "state", "last_report.json")), "refresh report wrote last_report.json"
dry = json.loads(run("report", "--refresh", "--dry-run"))
assert dry["report"]["type"] == "refresh"

# 4. DOCKER-USER allowlist parsing and backup ignore (unit level)
spec = importlib.util.spec_from_file_location("pc", COLLECTOR)
pc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc)
rules = """-N DOCKER-USER
-A DOCKER-USER -s 192.0.2.10/32 -p tcp -m conntrack --ctorigdstport 5432 -j ACCEPT
-A DOCKER-USER -p tcp -m conntrack --ctorigdstport 5432 -j DROP
-A DOCKER-USER ! -s 198.51.100.7/32 -p tcp -m tcp --dport 6543 -j DROP
-A DOCKER-USER -s 203.0.113.9/32 -p tcp -m tcp --dport 3306 -j DROP
-A DOCKER-USER -p tcp -m multiport --dports 27017,9200:9201 -j REJECT
-A DOCKER-USER -j RETURN"""
res = pc.docker_user_restrictions(rules)
assert res[5432] == ["192.0.2.10/32"], res
assert res[6543] == ["198.51.100.7/32"], res
assert 3306 not in res, "dropping one source does not restrict a port"
assert 27017 in res and 9200 in res and 9201 in res, res
assert pc.docker_user_restrictions("") == {}

bk = tempfile.mkdtemp()
os.makedirs(os.path.join(bk, "old-backups"))
os.makedirs(os.path.join(bk, "new-backups"))
cfg = {"PIXTAHA_BACKUP_DIRS": "%s/old-backups,%s/new-backups" % (bk, bk), "PIXTAHA_BACKUP_IGNORE": "%s/old-backups" % bk}
dirs = pc.backup_dirs(cfg)
assert os.path.realpath(os.path.join(bk, "new-backups")) in dirs
assert os.path.realpath(os.path.join(bk, "old-backups")) not in dirs

# 4b. backups of generically named containers (exact file-name prefix) and domains of stopped containers
import datetime as _dt
t1 = _dt.datetime(2026, 11, 8, 3, 30, tzinfo=_dt.timezone.utc)
files = [("/root/pixtaha-backups/2026-11-08/postgres-all.sql.gz", t1, 10),
         ("/root/pixtaha-backups/2026-11-08/postgresql-other.sql.gz", t1 + _dt.timedelta(hours=1), 10),
         ("/root/pixtaha-backups/2026-11-08/supabase-db.sql.gz", t1, 10)]
assert pc.newest_exact(files, "postgres") == t1, "exact container-name prefix not matched"
assert pc.newest_exact(files, "redis") is None
running = {"Name": "/n8n-a", "State": {"Status": "running"}, "Config": {"Labels": {"traefik.http.routers.a.rule": "Host(`a.example.com`)"}}}
stopped = {"Name": "/n8n-b", "State": {"Status": "exited"}, "Config": {"Labels": {"traefik.http.routers.b.rule": "Host(`b.example.com`)"}}}
doms = pc.domains_from_configs([running, stopped])
assert "a.example.com" in doms and "b.example.com" not in doms, doms

# 5. without live config the live command exits cleanly (the service stays stopped)
with open(env["PIXTAHA_CONFIG"], "w") as f:
    f.write("PIXTAHA_CLIENT=Demo Client\nPIXTAHA_ENV=demo\nPIXTAHA_REPORT_TOKEN=%s\n" % TOKEN)
n = len(got)
assert "live updates are off" in run("live")
assert len(got) == n

srv.shutdown()
print("live tests passed: %d live pushes, %d refresh reports" % (
    sum(1 for g in got if g["path"].endswith("/sm_live")), sum(1 for g in got if g["path"].endswith("/sm_push_report"))))
