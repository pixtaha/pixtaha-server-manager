#!/usr/bin/env python3
"""Alert tests: runs `sample` against the fake docker CLI and a local capture server.

Checks: a new alert is sent once (after the 2-sample debounce), is not repeated, "resolved" is sent once,
a 1-sample flap does not page, every sample sends a heartbeat, and no secret reaches the body.
Fictional data only.
"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
COLLECTOR = os.path.join(HERE, "..", "pixtaha_collector.py")
TOKEN = "test-token-do-not-leak"
received = []
FAIL = {"next": False}


class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        received.append({"path": self.path, "token": self.headers.get("X-Report-Token"), "raw": body.decode()})
        self.send_response(500 if FAIL["next"] else 200)
        FAIL["next"] = False
        self.end_headers()
        self.wfile.write(b"{}")

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
            "PIXTAHA_WEBHOOK_URL=http://127.0.0.1:%d/webhook/server-daily-report\n"
            "PIXTAHA_REPORT_TOKEN=%s\nPIXTAHA_ALERT_DOMAINS=off\n" % (port, TOKEN))
env = dict(os.environ, PATH=os.path.join(fx, "bin") + ":" + os.environ["PATH"], FAKE_DOCKER_DIR=fx,
           PIXTAHA_STATE_DIR=os.path.join(fx, "state"), PIXTAHA_CONFIG=os.path.join(fx, "config.env"))
INSPECT = os.path.join(fx, "inspect.json")


def set_state(name, status, oom=False):
    cs = json.load(open(INSPECT))
    for c in cs:
        if c["Name"] == "/" + name:
            c["State"]["Status"] = status
            c["State"]["OOMKilled"] = oom
            c["State"]["ExitCode"] = 137 if status == "exited" else 0
            c["State"]["FinishedAt"] = "2026-11-04T10:00:00Z" if status == "exited" else "0001-01-01T00:00:00Z"
    json.dump(cs, open(INSPECT, "w"))


def sample():
    n = len(received)
    out = subprocess.run([sys.executable, COLLECTOR, "sample"], env=env, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stdout + out.stderr
    assert len(received) == n + 1, "every sample must send exactly one heartbeat:\n" + out.stdout + out.stderr
    r = received[-1]
    assert r["path"] == "/webhook/server-alert", r["path"]
    assert r["token"] == TOKEN
    assert TOKEN not in r["raw"] and "do-not-leak" not in r["raw"], "secret leaked into the alert body"
    b = json.loads(r["raw"])
    assert b["schema_version"] == "1.0" and b["heartbeat"] is True and b["hostname"] == "demo-host"
    assert b["client"] == "Demo Client" and b["env"] == "demo"
    return {a["key"] for a in b["alerts"]}, {x["key"] for x in b["resolved"]}


def keys(prefix, ks):
    return {k for k in ks if k.startswith(prefix)}


# baseline: all running, nothing to send
for _ in range(2):
    a, r = sample()
    assert not keys("container.", a) and not r, (a, r)

# flap: down for one sample only -> no page
set_state("rembg", "exited")
a, r = sample()
assert "container.down:rembg" not in a, "debounce failed: alert after one sample"
set_state("rembg", "running")
a, r = sample()
assert "container.down:rembg" not in a and not r

# real outage: sent once after 2 samples, then never repeated
set_state("rembg", "exited")
a, _ = sample()
assert "container.down:rembg" not in a
a, _ = sample()
assert "container.down:rembg" in a, "alert not sent after 2 samples"
for _ in range(3):
    a, r = sample()
    assert "container.down:rembg" not in a, "alert repeated"
    assert not r

# recovery: resolved sent once after 2 clean samples
set_state("rembg", "running")
a, r = sample()
assert "container.down:rembg" not in r, "resolved sent too early"
a, r = sample()
assert "container.down:rembg" in r, "resolved not sent"
a, r = sample()
assert not r, "resolved repeated"

# essential container (n8n) not running + OOM kill
set_state("n8n-alpha", "exited", oom=True)
sample()
a, _ = sample()
assert {"container.down:n8n-alpha", "container.oom:n8n-alpha"} <= a, a
a, _ = sample()
assert not keys("container.", a), "repeated after send"

# a failed POST is retried by the next sample (not marked as sent)
set_state("supabase-db", "exited")
sample()
FAIL["next"] = True
a, _ = sample()
assert "container.down:supabase-db" in a
a, _ = sample()
assert "container.down:supabase-db" in a, "alert lost after a failed POST"
a, _ = sample()
assert "container.down:supabase-db" not in a

srv.shutdown()
print("alert tests passed: %d heartbeats" % len(received))
