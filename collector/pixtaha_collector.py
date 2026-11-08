#!/usr/bin/env python3
"""Pixtaha Management collector.

Read-only server monitor. Two jobs, both run by systemd timers:

  sample   every 5 minutes: CPU, RAM, disk and container state -> local state,
           then critical alert checks + heartbeat -> n8n alert webhook
  report   once a day (08:55 Africa/Cairo): builds payload v1 and posts it to n8n

It never changes anything on the server. It only reads /proc, config files and
logs, runs read-only commands (docker inspect/ps/stats/logs, ss, sshd -T,
systemctl show, ufw status, journalctl) and writes its own state to
/var/lib/pixtaha-collector. Secrets are never read into the payload: container
environment values are ignored except an allowlist of non-secret n8n settings.

Contract: docs/report/payload-v1.md
Python 3.8+, standard library only.
"""

import argparse
import datetime as dt
import fcntl
import glob
import http.client
import ipaddress
import json
import os
import pwd
import re
import shutil
import socket
import sqlite3
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

VERSION = "1.2.0"
SCHEMA = "1.0"

CONFIG_FILE = os.environ.get("PIXTAHA_CONFIG", "/etc/pixtaha-collector/config.env")
STATE_DIR = os.environ.get("PIXTAHA_STATE_DIR", "/var/lib/pixtaha-collector")
AUTH_LOGS = ["/var/log/auth.log", "/var/log/secure"]

SAMPLE_KEEP_H = 26
DB_PORTS = {5432, 6543, 3306, 6379, 27017, 5984, 9200, 11211}
DB_IMAGE = re.compile(r"(^|/)(postgres|supabase/postgres|timescaledb|postgis|redis|valkey|mysql|mariadb|mongo)(:|$)")
INFRA_IMAGE = re.compile(
    r"(postgres|redis|valkey|mysql|mariadb|mongo|supabase/|kong|postgrest|gotrue|realtime|storage-api|imgproxy|"
    r"edge-runtime|postgres-meta|supavisor|studio|logflare|vector|traefik|nginx|caddy|portainer|watchtower)"
)
N8N_ENV_ALLOW = {"N8N_VERSION", "DB_TYPE", "N8N_HOST", "WEBHOOK_URL", "N8N_PORT", "N8N_PROTOCOL"}
STD_TIMERS = re.compile(
    r"^(apt-daily|apt-daily-upgrade|dpkg-db-backup|e2scrub|fstrim|fwupd|logrotate|man-db|motd-news|systemd-|"
    r"sysstat|update-notifier|ua-timer|ua-|snapd|snap\.|phpsessionclean|certbot|pixtaha-collector|apport|anacron|"
    r"launchpadlib|esm-cache|plocate|mlocate|mdcheck|mdmonitor|ubuntu-advantage|unattended)"
)
STD_CRON = {"e2scrub_all", "sysstat", "certbot", "popularity-contest", "php", "anacron", ".placeholder", "staticroute"}
QUIET_LISTENERS = {"sshd", "nginx", "caddy", "docker-proxy", "systemd-resolve", "chronyd", "dockerd", "containerd"}
CLOUDFLARE = [ipaddress.ip_network(n) for n in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
)]
BACKUP_FILE = re.compile(r"\.(tar|tgz|gz|zip|7z|zst|xz|bz2|sql|dump|bak|backup|json|sqlite|db)$", re.I)
SEV_RANK = {"critical": 0, "warning": 1, "offline": 2, "unknown": 3, "info": 4, "healthy": 5}


# --------------------------------------------------------------------------- helpers

def log(msg):
    print("[pixtaha-collector] " + msg, flush=True)


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    if t is None:
        return None
    if isinstance(t, (int, float)):
        t = dt.datetime.fromtimestamp(t, dt.timezone.utc)
    return t.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(s):
    if not s or s.startswith("0001-"):
        return None
    s = s.replace("Z", "+00:00")
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(.*)$", s)
    if not m:
        return None
    frac = (m.group(2) or "")[:7]
    try:
        return dt.datetime.fromisoformat(m.group(1) + frac + (m.group(3) or "+00:00"))
    except ValueError:
        return None


def run(cmd, timeout=30, ok_codes=(0,)):
    """Run a read-only command. Returns stdout text or None."""
    exe = shutil.which(cmd[0]) if not os.path.isabs(cmd[0]) else cmd[0]
    if not exe:
        return None
    try:
        p = subprocess.run([exe] + cmd[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, env=dict(os.environ, LC_ALL="C", LANG="C"))
    except (subprocess.TimeoutExpired, OSError):
        return None
    if p.returncode not in ok_codes:
        return None
    return p.stdout.decode("utf-8", "replace")


def run_both(cmd, timeout=30):
    exe = shutil.which(cmd[0])
    if not exe:
        return None, None
    try:
        p = subprocess.run([exe] + cmd[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, env=dict(os.environ, LC_ALL="C", LANG="C"))
    except (subprocess.TimeoutExpired, OSError):
        return None, None
    return p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def read(path, default=None):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return default


def load_json(name, default):
    try:
        with open(os.path.join(STATE_DIR, name), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(name, data):
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    path = os.path.join(STATE_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


class StateLock:
    def __enter__(self):
        os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
        self.f = open(os.path.join(STATE_DIR, ".lock"), "w")
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def load_config():
    cfg = {}
    txt = read(CONFIG_FILE, "")
    for line in txt.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        cfg[k.strip()] = v
    for k, v in os.environ.items():
        if k.startswith("PIXTAHA_") and k not in cfg:
            cfg[k] = v
    return cfg


def r1(x):
    return None if x is None else round(float(x), 1)


def mb_from_human(s):
    """'123.4MiB' -> 123.4 ; '1.2GiB' -> 1228.8"""
    m = re.match(r"^\s*([\d.]+)\s*([KMGT]?i?B)\s*$", s or "")
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2).upper().replace("I", "")
    return round(n * {"B": 1 / 1048576, "KB": 1 / 1024, "MB": 1, "GB": 1024, "TB": 1048576}.get(unit, 1), 1)


def worst(sevs):
    best = "healthy"
    for s in sevs:
        if SEV_RANK.get(s, 9) < SEV_RANK.get(best, 9):
            best = s
    return best


# --------------------------------------------------------------------------- host metrics

def cpu_counters():
    line = (read("/proc/stat", "") or "").splitlines()[0].split()
    vals = [int(x) for x in line[1:9]]
    return sum(vals), vals[3] + vals[4]


def cpu_pct_between(a, b):
    dt_total = b[0] - a[0]
    if dt_total <= 0:
        return None
    return round(100.0 * (dt_total - (b[1] - a[1])) / dt_total, 1)


def meminfo():
    info = {}
    for line in (read("/proc/meminfo", "") or "").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            info[parts[0].rstrip(":")] = int(parts[1])
    total = info.get("MemTotal", 0) // 1024
    avail = info.get("MemAvailable", info.get("MemFree", 0)) // 1024
    swap_total = info.get("SwapTotal", 0) // 1024
    swap_used = swap_total - info.get("SwapFree", 0) // 1024
    return {"total_mb": total, "used_mb": total - avail, "swap_total_mb": swap_total, "swap_used_mb": swap_used}


def disk_root():
    st = os.statvfs("/")
    total = st.f_blocks * st.f_frsize
    used = (st.f_blocks - st.f_bfree) * st.f_frsize
    avail = st.f_bavail * st.f_frsize
    pct = round(100.0 * used / (used + avail), 1) if used + avail else None
    return {"total_gb": round(total / 1073741824, 1), "used_gb": round(used / 1073741824, 1), "used_pct": pct}


def uptime_seconds():
    try:
        return int(float((read("/proc/uptime", "0") or "0").split()[0]))
    except ValueError:
        return None


def os_release():
    txt = read("/etc/os-release", "") or ""
    m = re.search(r'^PRETTY_NAME="?([^"\n]+)"?', txt, re.M)
    return m.group(1) if m else None


def host_ips():
    ips = set()
    out = run(["ip", "-o", "addr", "show", "scope", "global"]) or ""
    for m in re.finditer(r"\binet6?\s+([0-9a-fA-F:.]+)/", out):
        ips.add(m.group(1))
    return ips


def public_ipv4(cfg, ips):
    if cfg.get("PIXTAHA_PUBLIC_IP"):
        return cfg["PIXTAHA_PUBLIC_IP"]
    for ip in sorted(ips):
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if a.version == 4 and a.is_global:
            return ip
    return None


# --------------------------------------------------------------------------- docker

def docker_available():
    return shutil.which("docker") is not None and run(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=20) is not None


def docker_inspect_all():
    ids = (run(["docker", "ps", "-aq", "--no-trunc"], timeout=30) or "").split()
    if not ids:
        return []
    out = []
    for i in range(0, len(ids), 50):
        txt = run(["docker", "inspect"] + ids[i:i + 50], timeout=60)
        if txt:
            try:
                out.extend(json.loads(txt))
            except ValueError:
                pass
    return out


def split_image(ref):
    """'docker.n8n.io/n8nio/n8n:2.33.4' -> ('docker.n8n.io/n8nio/n8n', '2.33.4', True)"""
    if not ref:
        return None, None, False
    if "@sha256:" in ref:
        return ref.split("@", 1)[0], "digest", True
    if re.match(r"^(sha256:)?[0-9a-f]{12,64}$", ref):
        return "image-id", ref.replace("sha256:", "")[:12], True
    last = ref.rsplit("/", 1)[-1]
    if ":" in last:
        repo, tag = ref.rsplit(":", 1)
    else:
        repo, tag = ref, None
    return repo, tag, tag not in (None, "latest")


def container_ports(c):
    seen = {}
    for spec, binds in ((c.get("NetworkSettings") or {}).get("Ports") or {}).items():
        for b in binds or []:
            try:
                port = int(b.get("HostPort") or 0)
            except ValueError:
                continue
            if not port:
                continue
            host = b.get("HostIp") or "0.0.0.0"
            public = host in ("0.0.0.0", "::", "")
            prev = seen.get(port)
            if prev is None or (public and not prev["public"]):
                seen[port] = {"port": port, "bind": "0.0.0.0" if public else host, "public": public,
                              "proto": spec.split("/")[-1] if "/" in spec else "tcp"}
    return sorted(seen.values(), key=lambda x: x["port"])


def container_env(c, allow):
    out = {}
    for item in (c.get("Config") or {}).get("Env") or []:
        k, _, v = item.partition("=")
        if k in allow:
            out[k] = v
    return out


def compact_container(c):
    st = c.get("State") or {}
    return {
        "id": c.get("Id", "")[:64],
        "name": (c.get("Name") or "").lstrip("/"),
        "state": st.get("Status"),
        "rc": c.get("RestartCount", 0),
        "started": st.get("StartedAt"),
        "oom": bool(st.get("OOMKilled")),
    }


def docker_stats():
    out = run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], timeout=90) or ""
    stats = {}
    for line in out.splitlines():
        try:
            j = json.loads(line)
        except ValueError:
            continue
        cpu = j.get("CPUPerc", "").rstrip("%")
        mem = (j.get("MemUsage") or "").split("/")[0]
        try:
            cpu = round(float(cpu), 1)
        except ValueError:
            cpu = None
        stats[j.get("Name")] = {"cpu_pct": cpu, "mem_mb": mb_from_human(mem)}
    return stats


def kernel_oom_by_container(since_h=24):
    txt = run(["journalctl", "-k", "--since", "-%dh" % since_h, "--no-pager", "-o", "cat"], timeout=60)
    if txt is None:
        txt = run(["dmesg"], timeout=20) or ""
    counts, total = {}, 0
    for line in txt.splitlines():
        if "oom-kill:" not in line:
            continue
        total += 1
        m = re.search(r"task_memcg=\S*docker[-/]([0-9a-f]{64})", line) or re.search(r"docker[-/]([0-9a-f]{64})", line)
        if m:
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return counts, total


def crash_cause(name):
    txt, err = run_both(["docker", "logs", "--since", "24h", "--tail", "3000", name], timeout=30)
    blob = (txt or "") + (err or "")
    if "heap out of memory" in blob:
        return "JavaScript heap out of memory"
    if "Killed" in blob and "exit code 137" in blob:
        return "killed (exit 137)"
    return None


# --------------------------------------------------------------------------- sample

def take_sample():
    t = now_utc()
    cnt = cpu_counters()
    prev = load_json("last_cpu.json", None)
    cpu = None
    if prev and t.timestamp() - prev.get("t", 0) < 900:
        cpu = cpu_pct_between(prev["c"], cnt)
    if cpu is None:
        time.sleep(1)
        cnt2 = cpu_counters()
        cpu = cpu_pct_between(cnt, cnt2)
        cnt = cnt2
    save_json("last_cpu.json", {"t": t.timestamp(), "c": list(cnt)})
    mem = meminfo()
    disk = disk_root()
    sample = {
        "t": iso(t), "cpu": cpu,
        "ram": round(100.0 * mem["used_mb"] / mem["total_mb"], 1) if mem["total_mb"] else None,
        "ram_mb": mem["used_mb"], "swap_mb": mem["swap_used_mb"],
        "disk": disk["used_pct"], "disk_gb": disk["used_gb"],
    }
    cs = []
    if shutil.which("docker"):
        cs = docker_inspect_all()
        if cs:
            sample["c"] = [compact_container(c) for c in cs]
    path = os.path.join(STATE_DIR, "samples.jsonl")
    cutoff = t - dt.timedelta(hours=SAMPLE_KEEP_H)
    kept = []
    for line in (read(path, "") or "").splitlines():
        try:
            s = json.loads(line)
        except ValueError:
            continue
        ts = parse_iso(s.get("t"))
        if ts and ts >= cutoff:
            kept.append(line)
    kept.append(json.dumps(sample, separators=(",", ":")))
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(kept) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    return sample, cs


def load_samples(start, end):
    out = []
    for line in (read(os.path.join(STATE_DIR, "samples.jsonl"), "") or "").splitlines():
        try:
            s = json.loads(line)
        except ValueError:
            continue
        ts = parse_iso(s.get("t"))
        if ts and start <= ts <= end:
            s["_t"] = ts
            out.append(s)
    return out


# --------------------------------------------------------------------------- sysstat fallback

def sadf_series(start, end, flag, column):
    """Returns [(epoch, value)] from sysstat files covering [start, end]."""
    if not shutil.which("sadf"):
        return []
    files = []
    for base in ("/var/log/sysstat", "/var/log/sa"):
        for d in sorted({start.astimezone().date(), end.astimezone().date()}):
            for name in ("sa%02d" % d.day, "sa%s" % d.strftime("%Y%m%d")):
                p = os.path.join(base, name)
                if os.path.exists(p) and p not in files:
                    files.append(p)
    out = []
    for f in files:
        txt = run(["sadf", "-d", "-U", f, "--", flag], timeout=30) or ""
        idx = None
        for line in txt.splitlines():
            if line.startswith("#"):
                cols = line.lstrip("# ").split(";")
                idx = cols.index(column) if column in cols else None
                continue
            if idx is None:
                continue
            parts = line.split(";")
            try:
                ts = int(parts[2])
                if flag == "-u" and parts[3] not in ("-1", "all"):
                    continue
                v = float(parts[idx])
            except (ValueError, IndexError):
                continue
            if start.timestamp() <= ts <= end.timestamp():
                out.append((ts, 100.0 - v if column == "%idle" else v))
    return out


# --------------------------------------------------------------------------- KPIs

def hourly(points, start):
    """points: [(epoch, value)] -> 24 hourly averages, oldest first."""
    buckets = [[] for _ in range(24)]
    s0 = start.timestamp()
    for ts, v in points:
        if v is None:
            continue
        i = int((ts - s0) // 3600)
        if 0 <= i < 24:
            buckets[i].append(v)
    return [round(sum(b) / len(b), 1) if b else None for b in buckets]


def merge_hourly(primary, fallback):
    return [p if p is not None else f for p, f in zip(primary, fallback)]


def build_kpis(samples, start, end, mem, disk, state):
    cpu_pts = [(s["_t"].timestamp(), s.get("cpu")) for s in samples]
    ram_pts = [(s["_t"].timestamp(), s.get("ram")) for s in samples]
    disk_pts = [(s["_t"].timestamp(), s.get("disk")) for s in samples]
    cpu_h, ram_h, disk_h = hourly(cpu_pts, start), hourly(ram_pts, start), hourly(disk_pts, start)
    if sum(1 for x in cpu_h if x is not None) < 20:
        cpu_sys = sadf_series(start, end, "-u", "%idle")
        ram_sys = sadf_series(start, end, "-r", "%memused")
        cpu_h = merge_hourly(cpu_h, hourly(cpu_sys, start))
        ram_h = merge_hourly(ram_h, hourly(ram_sys, start))
        cpu_pts = cpu_pts + cpu_sys
        ram_pts = ram_pts + ram_sys
    cpu_vals = [(ts, v) for ts, v in cpu_pts if v is not None]
    ram_vals = [v for _, v in ram_pts if v is not None]
    if cpu_vals:
        avg = sum(v for _, v in cpu_vals) / len(cpu_vals)
        peak_ts, peak = max(cpu_vals, key=lambda x: x[1])
    else:
        a, b = cpu_counters(), None
        time.sleep(1)
        b = cpu_counters()
        avg = peak = cpu_pct_between(a, b)
        peak_ts = end.timestamp()
    # disk trend: one point per daily report, linear fit over up to 14 days
    hist = state.get("disk_history", [])
    days_full = None
    pts = [(h["t"], h["gb"]) for h in hist][-14:] + [(end.timestamp(), disk["used_gb"])]
    if len(pts) >= 3:
        n = len(pts)
        xs = [p[0] / 86400.0 for p in pts]
        ys = [p[1] for p in pts]
        mx, my = sum(xs) / n, sum(ys) / n
        den = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0
        if slope > 0.01:
            days_full = int(max(0, (disk["total_gb"] - disk["used_gb"]) / slope))
    return {
        "cpu_avg_pct": r1(avg),
        "cpu_peak_pct": r1(peak),
        "cpu_peak_at": iso(peak_ts) if peak is not None else None,
        "cpu_hourly_pct": cpu_h,
        "ram_used_mb": mem["used_mb"],
        "ram_peak_pct": r1(max(ram_vals)) if ram_vals else r1(100.0 * mem["used_mb"] / mem["total_mb"]),
        "ram_hourly_pct": ram_h,
        "disk_used_pct": disk["used_pct"],
        "disk_used_gb": disk["used_gb"],
        "disk_hourly_pct": disk_h,
        "disk_days_until_full": days_full,
    }


# --------------------------------------------------------------------------- n8n

def n8n_sqlite_counts(path, since):
    """Read-only counts from an n8n SQLite database. Names and counts only."""
    out = {"workflows_total": None, "workflows_active": None, "executions_ok_24h": None, "executions_failed_24h": None}
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=5)
    except sqlite3.Error:
        return out
    try:
        cur = con.cursor()
        cols = [r[1] for r in cur.execute("PRAGMA table_info(workflow_entity)")]
        where = " WHERE isArchived = 0" if "isArchived" in cols else ""
        out["workflows_total"] = cur.execute("SELECT COUNT(*) FROM workflow_entity" + where).fetchone()[0]
        if "active" in cols:
            out["workflows_active"] = cur.execute(
                "SELECT COUNT(*) FROM workflow_entity" + (where + " AND" if where else " WHERE") + " active = 1").fetchone()[0]
        ecols = [r[1] for r in cur.execute("PRAGMA table_info(execution_entity)")]
        since_s = since.strftime("%Y-%m-%d %H:%M:%S")
        if "status" in ecols:
            rows = cur.execute("SELECT status, COUNT(*) FROM execution_entity WHERE startedAt >= ? GROUP BY status",
                               (since_s,)).fetchall()
            d = dict(rows)
            out["executions_ok_24h"] = d.get("success", 0)
            out["executions_failed_24h"] = d.get("error", 0) + d.get("crashed", 0)
        elif "finished" in ecols:
            rows = cur.execute("SELECT finished, COUNT(*) FROM execution_entity WHERE startedAt >= ? GROUP BY finished",
                               (since_s,)).fetchall()
            d = dict(rows)
            out["executions_ok_24h"] = d.get(1, 0)
            out["executions_failed_24h"] = d.get(0, 0)
    except sqlite3.Error:
        pass
    finally:
        con.close()
    return out


def n8n_version_from_fs(c):
    """Reads n8n's package.json through the container's overlay MergedDir (host read, no exec)."""
    merged = (((c.get("GraphDriver") or {}).get("Data")) or {}).get("MergedDir")
    if not merged:
        return None
    for rel in ("usr/local/lib/node_modules/n8n/package.json", "usr/lib/node_modules/n8n/package.json"):
        txt = read(os.path.join(merged, rel))
        if txt:
            m = re.search(r'"version"\s*:\s*"([^"]+)"', txt)
            if m:
                return m.group(1)
    return None


def n8n_data_dir(c):
    for m in c.get("Mounts") or []:
        if m.get("Destination") in ("/home/node/.n8n", "/root/.n8n"):
            return m.get("Source")
    return None


def build_n8n(containers, since, state, mem_limits):
    insts = []
    prev_sizes = state.get("n8n_db_mb", {})
    sizes = {}
    for c in containers:
        repo, tag, pinned = split_image((c.get("Config") or {}).get("Image"))
        if not (repo and re.search(r"(^|/)n8n$", repo)) and not n8n_data_dir(c):
            continue
        st = (c.get("State") or {}).get("Status")
        if st not in ("running", "restarting"):
            continue
        name = (c.get("Name") or "").lstrip("/")
        env = container_env(c, N8N_ENV_ALLOW)
        db_type = "postgresdb" if env.get("DB_TYPE", "").startswith("postgres") else "sqlite"
        host = env.get("N8N_HOST")
        if (not host or host == "localhost") and env.get("WEBHOOK_URL"):
            host = re.sub(r"^https?://", "", env["WEBHOOK_URL"]).split("/")[0]
        inst = {
            "name": name, "container": name, "version": env.get("N8N_VERSION") or n8n_version_from_fs(c) or (tag if pinned and tag != "digest" else None),
            "pinned": pinned, "status": "healthy", "host": host or None,
            "db_type": db_type, "db_size_mb": None, "db_growth_mb_24h": None,
            "workflows_total": None, "workflows_active": None,
            "executions_ok_24h": None, "executions_failed_24h": None,
            "mem_limit_mb": mem_limits.get(name), "telegram_webhooks": [], "schedules_missed_24h": None,
            "dead_host_nodes": None,
        }
        notes = []
        if db_type == "sqlite":
            d = n8n_data_dir(c)
            dbp = os.path.join(d, "database.sqlite") if d else None
            if dbp and os.path.exists(dbp):
                size = round(os.path.getsize(dbp) / 1048576, 1)
                inst["db_size_mb"] = size
                sizes[name] = size
                if name in prev_sizes:
                    inst["db_growth_mb_24h"] = round(size - prev_sizes[name], 1)
                inst.update(n8n_sqlite_counts(dbp, since))
            else:
                notes.append("SQLite file not found")
        else:
            notes.append("Postgres: counts need DB access")
        sev = "healthy"
        if st == "restarting":
            sev = "critical"
        if (inst["executions_failed_24h"] or 0) >= 5:
            sev = worst([sev, "warning"])
            notes.append("%d failed executions" % inst["executions_failed_24h"])
        if (inst["db_size_mb"] or 0) > 1024 or (inst["db_growth_mb_24h"] or 0) > 100:
            sev = worst([sev, "warning"])
            notes.append("SQLite %.1f GB" % ((inst["db_size_mb"] or 0) / 1024))
        if not pinned:
            notes.append("image not pinned")
        if inst["mem_limit_mb"] is None:
            notes.append("No memory limit")
        inst["status"] = sev
        inst["note"] = " · ".join(notes) or None
        insts.append(inst)
    return sorted(insts, key=lambda x: (SEV_RANK.get(x["status"], 9), x["name"])), sizes


# --------------------------------------------------------------------------- containers

def build_containers(containers, samples, oom_by_id, stats, window_start):
    items, compact_now = [], []
    first_seen = {}
    for s in samples:
        for c in s.get("c") or []:
            first_seen.setdefault(c["id"], c)
    total = running = restarts = ooms = unpinned = nolimit = 0
    mem_limits = {}
    for c in containers:
        cc = compact_container(c)
        name = cc["name"]
        total += 1
        st = cc["state"]
        if st == "running":
            running += 1
        repo, tag, pinned = split_image((c.get("Config") or {}).get("Image"))
        lim = (c.get("HostConfig") or {}).get("Memory") or 0
        lim_mb = int(lim / 1048576) if lim else None
        mem_limits[name] = lim_mb
        # restarts within the window
        fs = first_seen.get(cc["id"])
        if fs is not None:
            r = max(0, (cc["rc"] or 0) - (fs.get("rc") or 0))
            if fs.get("started") != cc["started"] and r == 0 and st == "running":
                r = 1
            fs_started = parse_iso(fs.get("started"))
            if fs_started and fs_started >= window_start and (fs.get("rc") or 0) > 0:
                r += 1  # restarted inside the window, before the first sample we have
        else:
            started = parse_iso(cc["started"])
            r = 1 if (started and started >= window_start and (cc["rc"] or 0) > 0) else 0
        oom = oom_by_id.get(cc["id"], 0)
        if not oom and cc["oom"]:
            fin = parse_iso((c.get("State") or {}).get("FinishedAt"))
            if fin and fin >= window_start:
                oom = 1
        restarts += r
        ooms += oom
        is_app = not INFRA_IMAGE.search(repo or "")
        if not pinned and st == "running":
            unpinned += 1
        if lim_mb is None and is_app and st == "running":
            nolimit += 1
        ports = container_ports(c)
        sev, issue = "healthy", None
        if st == "restarting" or oom:
            sev = "critical"
        elif r >= 3:
            sev = "warning"
        elif st in ("exited", "dead", "created", "paused"):
            code = (c.get("State") or {}).get("ExitCode")
            policy = ((c.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name")
            sev = "warning" if (code and policy in ("always", "unless-stopped")) else "info"
        elif not pinned or (lim_mb is None and is_app) or any(p["public"] for p in ports):
            sev = "warning"
        if r and st == "running":
            cause = crash_cause(name)
            if cause:
                issue = "Restarted %d× in 24h: %s" % (r, cause)
                sev = worst([sev, "warning"])
        st_now = stats.get(name, {})
        items.append({
            "name": name, "image": repo, "tag": tag, "pinned": pinned, "status": sev, "state": st,
            "restarts_24h": r, "oom_kills_24h": oom,
            "cpu_pct": st_now.get("cpu_pct"), "mem_mb": st_now.get("mem_mb"), "mem_limit_mb": lim_mb,
            "ports": [{"port": p["port"], "bind": p["bind"], "public": p["public"]} for p in ports],
            "compose_project": ((c.get("Config") or {}).get("Labels") or {}).get("com.docker.compose.project"),
            "_app": is_app,
        })
        if issue:
            items[-1]["issue"] = issue
        compact_now.append(cc)
    items.sort(key=lambda x: (SEV_RANK.get(x["status"], 9), x["name"]))
    shown = items if len(items) <= 20 else [x for x in items if x["status"] not in ("healthy",)]
    block = {
        "running": running, "total": total, "restarts_24h": restarts, "oom_kills_24h": ooms,
        "unpinned_images": unpinned, "missing_memory_limit": nolimit,
        "items": [{k: v for k, v in x.items() if not k.startswith("_")} for x in shown],
    }
    return block, items, mem_limits


# --------------------------------------------------------------------------- databases

def build_databases(containers, n8n_insts, backups_files):
    dbs = []
    families = {}
    for c in containers:
        if (c.get("State") or {}).get("Status") == "running":
            repo = split_image((c.get("Config") or {}).get("Image"))[0] or ""
            if DB_IMAGE.search(repo + ":"):
                fam = "pg" if re.search(r"postgres|timescale|postgis", repo) else repo.rsplit("/", 1)[-1]
                families[fam] = families.get(fam, 0) + 1
    for c in containers:
        if (c.get("State") or {}).get("Status") != "running":
            continue
        repo, tag, _ = split_image((c.get("Config") or {}).get("Image"))
        if not repo or not DB_IMAGE.search(repo + ":"):
            continue
        name = (c.get("Name") or "").lstrip("/")
        base = repo.rsplit("/", 1)[-1]
        engine = ("Supabase" if "supabase" in repo else "Postgres") if ("postgres" in base or "timescale" in base or "postgis" in base) \
            else "Redis" if base in ("redis", "valkey") else "MySQL" if base in ("mysql", "mariadb") else "MongoDB"
        size = None
        for m in c.get("Mounts") or []:
            dest = m.get("Destination") or ""
            if dest.startswith("/var/lib/postgresql") or dest in ("/data", "/var/lib/mysql", "/data/db"):
                out = run(["du", "-sm", m.get("Source", "/nonexistent")], timeout=120)
                if out:
                    try:
                        size = float(out.split()[0])
                    except (ValueError, IndexError):
                        pass
                break
        hint = r"(pg|postgres|supabase|dump|\.sql)" if engine in ("Postgres", "Supabase") else re.escape(base)
        fam = "pg" if engine in ("Postgres", "Supabase") else base
        project = ((c.get("Config") or {}).get("Labels") or {}).get("com.docker.compose.project")
        last = newest_for(backups_files, name_tokens(name, project), hint, families.get(fam, 0) == 1)
        dbs.append({
            "name": name, "engine": engine, "version": tag if tag not in (None, "latest", "digest") else None,
            "status": "info" if (engine == "Redis" and last is None) else backup_sev(last), "size_mb": size, "growth_mb_24h": None,
            "connections": None, "max_connections": None, "last_backup_at": iso(last) if last else None,
        })
    for inst in n8n_insts:
        if inst["db_type"] != "sqlite" or inst["db_size_mb"] is None:
            continue
        sqlite_count = sum(1 for i in n8n_insts if i["db_type"] == "sqlite")
        last = newest_for(backups_files, name_tokens(inst["name"]), r"n8n", sqlite_count == 1)
        sev = backup_sev(last)
        if inst["db_size_mb"] > 1024:
            sev = worst([sev, "warning"])
        dbs.append({
            "name": inst["name"] + " sqlite", "engine": "SQLite", "version": None, "status": sev,
            "size_mb": inst["db_size_mb"], "growth_mb_24h": inst["db_growth_mb_24h"],
            "connections": None, "max_connections": None, "last_backup_at": iso(last) if last else None,
        })
    return dbs


def backup_sev(last):
    if last is None:
        return "warning"
    h = (now_utc() - last).total_seconds() / 3600
    return "healthy" if h <= 48 else ("warning" if h <= 168 else "critical")


GENERIC_WORDS = {"postgres", "postgresql", "database", "data", "redis", "valkey", "mysql", "mariadb", "mongo",
                 "mongodb", "server", "main", "prod", "production", "docker", "compose", "default", "sqlite",
                 "backup", "backups", "n8n", "new", "old", "service"}


def name_tokens(*names):
    """Distinctive words of a container / compose project name, e.g. 'n8n-new-samier' -> {'samier'}."""
    out = set()
    for n in names:
        for t in re.split(r"[^a-z0-9]+", (n or "").lower()):
            if len(t) >= 4 and t not in GENERIC_WORDS:
                out.add(t)
    return out


def newest_for(files, tokens, hint, allow_generic):
    """files: [(path, mtime_dt, size)]. A backup belongs to a database when its path names the database
    (container or compose project). A generic match (e.g. any *.sql) is used only when the host has a
    single database of that kind, so one database's backup is never credited to another."""
    best = None
    for path, mt, _ in files:
        low = path.lower()
        if tokens and any(t in low for t in tokens) and (best is None or mt > best):
            best = mt
    if best is None and allow_generic:
        for path, mt, _ in files:
            if re.search(hint, path.lower()) and (best is None or mt > best):
                best = mt
    return best


# --------------------------------------------------------------------------- backups

def backup_dirs(cfg):
    dirs = set()
    pats = ["/backup*", "/backups", "/root/*backup*", "/opt/*backup*", "/opt/*/*backup*", "/srv/*backup*",
            "/srv/*/*backup*", "/home/*/*backup*", "/home/*/backups", "/mnt/*backup*", "/var/backups/*"]
    for p in pats:
        for d in glob.glob(p):
            if os.path.isdir(d) and "/.claude" not in d and d not in ("/var/backups",):
                dirs.add(os.path.realpath(d))
    for d in (cfg.get("PIXTAHA_BACKUP_DIRS") or "").split(","):
        d = d.strip()
        if d and os.path.isdir(d):
            dirs.add(os.path.realpath(d))
    # retired folders the operator keeps but no longer fills (PIXTAHA_BACKUP_IGNORE)
    ignore = [os.path.realpath(d.strip()) for d in (cfg.get("PIXTAHA_BACKUP_IGNORE") or "").split(",") if d.strip()]
    # drop nested duplicates and OS package backups
    out = []
    for d in sorted(dirs):
        if d.startswith("/var/backups") and not d.startswith("/var/backups/pixtaha"):
            continue
        if any(d == i or d.startswith(i + "/") for i in ignore):
            continue
        if any(d.startswith(o + "/") for o in out):
            continue
        out.append(d)
    return out


def scan_backups(cfg):
    blocks, files = [], []
    for d in backup_dirs(cfg):
        newest, n = None, 0
        base_depth = d.rstrip("/").count("/")
        for root, subdirs, fnames in os.walk(d):
            if root.count("/") - base_depth >= 3:
                subdirs[:] = []
            for fn in fnames:
                n += 1
                if n > 5000:
                    break
                if not BACKUP_FILE.search(fn):
                    continue
                p = os.path.join(root, fn)
                try:
                    stt = os.stat(p)
                except OSError:
                    continue
                mt = dt.datetime.fromtimestamp(stt.st_mtime, dt.timezone.utc)
                files.append((p, mt, stt.st_size))
                if newest is None or mt > newest[1]:
                    newest = (p, mt, stt.st_size)
        if newest:
            blocks.append({"name": d, "kind": "folder", "last_at": iso(newest[1]),
                           "size_mb": round(newest[2] / 1048576, 1), "status": backup_sev(newest[1])})
    return blocks, files


# --------------------------------------------------------------------------- systemd, cron, listeners

def systemd_show(unit, props):
    out = run(["systemctl", "show", unit, "-p", ",".join(props)], timeout=15) or ""
    d = {}
    for line in out.splitlines():
        k, _, v = line.partition("=")
        d[k] = v
    return d


def systemd_time(v):
    """'Wed 2026-11-04 03:00:11 CET' -> datetime (local tz assumed by systemctl)."""
    if not v or v == "n/a":
        return None
    m = re.search(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", v)
    if not m:
        return None
    try:
        return dt.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").astimezone().astimezone(dt.timezone.utc)
    except ValueError:
        return None


def build_scripts_services():
    scripts, services = [], []
    units = run(["systemctl", "list-units", "--type=timer", "--all", "--no-legend", "--plain"], timeout=15) or ""
    for line in units.splitlines():
        unit = line.split()[0] if line.split() else ""
        if not unit.endswith(".timer") or STD_TIMERS.match(unit):
            continue
        t = systemd_show(unit, ["Unit", "LastTriggerUSec", "TimersCalendar"])
        svc = t.get("Unit") or unit.replace(".timer", ".service")
        s = systemd_show(svc, ["Result", "ExecMainStartTimestamp", "ExecMainExitTimestamp", "ExecMainStatus"])
        last = systemd_time(t.get("LastTriggerUSec"))
        started, ended = systemd_time(s.get("ExecMainStartTimestamp")), systemd_time(s.get("ExecMainExitTimestamp"))
        result = None if last is None else ("ok" if s.get("Result") == "success" and s.get("ExecMainStatus", "0") == "0" else "failed")
        sched = None
        m = re.search(r"OnCalendar=([^;]+)", t.get("TimersCalendar", ""))
        if m:
            sched = m.group(1).strip()
        sev = "info" if last is None else ("healthy" if result == "ok" else ("critical" if "backup" in unit else "warning"))
        scripts.append({
            "name": unit.replace(".timer", ""), "kind": "systemd timer", "schedule": sched,
            "last_run_at": iso(last), "last_result": result,
            "duration_s": int((ended - started).total_seconds()) if started and ended and ended >= started else None,
            "status": sev,
        })
    for f in sorted(glob.glob("/etc/cron.d/*")):
        name = os.path.basename(f)
        if name in STD_CRON or name.startswith("."):
            continue
        for line in (read(f, "") or "").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or re.match(r"^[A-Z_]+=", line):
                continue
            parts = line.split()
            sched = " ".join(parts[:1]) if parts[0].startswith("@") else " ".join(parts[:5])
            scripts.append({"name": name, "kind": "cron", "schedule": sched, "last_run_at": None,
                            "last_result": None, "duration_s": None, "status": "info"})
            break
    for f in sorted(glob.glob("/var/spool/cron/crontabs/*")):
        user = os.path.basename(f)
        for line in (read(f, "") or "").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or re.match(r"^[A-Z_]+=", line):
                continue
            parts = line.split()
            n_sched = 1 if parts[0].startswith("@") else 5
            sched = " ".join(parts[:n_sched])
            script = next((os.path.basename(p) for p in parts[n_sched:] if re.search(r"\.(sh|py|js|php|rb)$", p)), None)
            scripts.append({"name": "%s crontab: %s" % (user, script or "command"), "kind": "cron", "schedule": sched,
                            "last_run_at": None, "last_result": None, "duration_s": None, "status": "info"})
    failed = run(["systemctl", "list-units", "--state=failed", "--no-legend", "--plain"], timeout=15) or ""
    n_failed = 0
    for line in failed.splitlines():
        if not line.split():
            continue
        n_failed += 1
        services.append({"name": line.split()[0].replace(".service", ""), "kind": "systemd", "status": "warning",
                         "state": "failed", "user": None, "port": None, "public": False, "latency_ms": None})
    running = run(["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--plain"], timeout=15) or ""
    units = {"running": len([l for l in running.splitlines() if l.strip()]), "failed": n_failed}
    return scripts, services, units


def listeners():
    """[(port, bind, proc, pid, public)] for TCP listeners."""
    out = run(["ss", "-Htlnp"], timeout=15) or ""
    res = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        m = re.match(r"^(.*):(\d+)$", local)
        if not m:
            continue
        bind, port = m.group(1).strip("[]"), int(m.group(2))
        bind = bind.split("%")[0]
        pm = re.search(r'users:\(\("([^"]+)",pid=(\d+)', line)
        proc, pid = (pm.group(1), int(pm.group(2))) if pm else (None, None)
        public = bind in ("0.0.0.0", "::", "*")
        res.append((port, bind, proc, pid, public))
    return res


def pid_user(pid):
    txt = read("/proc/%d/status" % pid, "") or ""
    m = re.search(r"^Uid:\s+(\d+)", txt, re.M)
    if not m:
        return None
    try:
        return pwd.getpwuid(int(m.group(1))).pw_name
    except KeyError:
        return m.group(1)


# --------------------------------------------------------------------------- security

AUTH_TS_ISO = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)?")
AUTH_TS_BSD = re.compile(r"^([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2})")
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def auth_line_time(line, ref):
    m = AUTH_TS_ISO.match(line)
    if m:
        t = parse_iso(m.group(1) + (m.group(3) or "+00:00"))
        if t and not m.group(3):
            t = t.replace(tzinfo=None).astimezone()
        return t
    m = AUTH_TS_BSD.match(line)
    if m:
        local = ref.astimezone()
        try:
            t = dt.datetime(local.year, MONTHS[m.group(1)], int(m.group(2)), int(m.group(3)), int(m.group(4)),
                            int(m.group(5))).astimezone()
        except (ValueError, KeyError):
            return None
        if t > ref + dt.timedelta(days=1):
            t = t.replace(year=t.year - 1)
        return t
    return None


def scan_auth(cfg, since):
    paths = [cfg["PIXTAHA_AUTH_LOG"]] if cfg.get("PIXTAHA_AUTH_LOG") else AUTH_LOGS
    path = next((p for p in paths if os.path.exists(p)), None)
    failed, accepted, method = 0, {}, {}
    ips = set()
    if path is None:
        return None, {}, set()
    ref = now_utc()
    for p in (path + ".1", path):
        if not os.path.exists(p):
            continue
        try:
            fh = open(p, "r", encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                if "sshd" not in line:
                    continue
                is_fail = ("Failed password" in line or "Failed publickey" in line or "Invalid user" in line)
                is_ok = "Accepted " in line
                if not (is_fail or is_ok):
                    continue
                t = auth_line_time(line, ref)
                if t is None or t < since:
                    continue
                if is_fail:
                    failed += 1
                else:
                    m = re.search(r"Accepted (\S+) for (\S+) from (\S+)", line)
                    if m:
                        ips.add(m.group(3))
                        method[m.group(1)] = method.get(m.group(1), 0) + 1
    return failed, method, ips


def sshd_settings():
    out = run(["sshd", "-T"], timeout=15) or run(["/usr/sbin/sshd", "-T"], timeout=15)
    if not out:
        return None, None
    d = {}
    for line in out.splitlines():
        k, _, v = line.partition(" ")
        d[k.lower()] = v.strip()
    pw = d.get("passwordauthentication")
    return (None if pw is None else pw == "yes"), d.get("permitrootlogin")


def firewall_active():
    out = run(["ufw", "status"], timeout=15)
    if out and out.strip().startswith("Status: active"):
        return True
    if run(["firewall-cmd", "--state"], timeout=10, ok_codes=(0,)) is not None:
        return True
    rules = run(["iptables", "-S", "INPUT"], timeout=10) or ""
    if re.search(r"^-P INPUT (DROP|REJECT)", rules, re.M):
        return True
    nft = run(["nft", "list", "chain", "inet", "filter", "input"], timeout=10) or ""
    if "policy drop" in nft:
        return True
    return False if out is not None or rules else None


def docker_user_restrictions(text=None):
    """Ports that the DOCKER-USER chain limits to known sources: {port: [allowed sources]}.
    A port counts as restricted when a DROP / REJECT rule matches it for every other source
    (no -s, or a negated ! -s). Docker-published ports bypass INPUT, so this is the chain that matters."""
    if text is None:
        text = run(["iptables", "-S", "DOCKER-USER"], timeout=10) or ""
    rules = {}
    for line in text.splitlines():
        if not line.startswith("-A DOCKER-USER"):
            continue
        ports = []
        m = re.search(r"--(?:dport|ctorigdstport|sport) (\d+)(?::(\d+))?", line)
        if m and "--sport" not in m.group(0):
            lo, hi = int(m.group(1)), int(m.group(2) or m.group(1))
            ports = list(range(lo, min(hi, lo + 100) + 1))
        mm = re.search(r"--dports (\S+)", line)
        if mm:
            for part in mm.group(1).split(","):
                a, _, b = part.partition(":")
                if a.isdigit():
                    ports += list(range(int(a), min(int(b or a), int(a) + 100) + 1))
        if not ports:
            continue
        tgt = re.search(r"-j (\w+)", line)
        tgt = tgt.group(1) if tgt else ""
        src = re.search(r"(!\s+)?-s (\S+)", line)
        for port in ports:
            r = rules.setdefault(port, {"drop": False, "allow": set()})
            if tgt in ("DROP", "REJECT"):
                if src is None:
                    r["drop"] = True
                elif src.group(1):
                    r["drop"] = True
                    r["allow"].add(src.group(2))
            elif tgt in ("ACCEPT", "RETURN") and src and not src.group(1):
                r["allow"].add(src.group(2))
    return {p: sorted(r["allow"]) for p, r in rules.items() if r["drop"]}


def tmp_executables():
    n = 0
    for base in ("/tmp", "/var/tmp", "/dev/shm"):
        base_depth = base.count("/")
        for root, subdirs, files in os.walk(base):
            if root.count("/") - base_depth >= 4:
                subdirs[:] = []
            subdirs[:] = [d for d in subdirs if not d.startswith(("claude", "systemd-private", "snap-private"))]
            for f in files:
                p = os.path.join(root, f)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if (st.st_mode & 0o111) and os.path.isfile(p) and not os.path.islink(p):
                    n += 1
    return n


def pending_updates():
    _, err = run_both(["/usr/lib/update-notifier/apt-check"], timeout=120)
    m = re.match(r"^(\d+);(\d+)", (err or "").strip())
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


# --------------------------------------------------------------------------- domains

def domains_from_configs(containers):
    found = {}
    for f in glob.glob("/etc/nginx/sites-enabled/*") + glob.glob("/etc/nginx/conf.d/*.conf"):
        txt = read(f, "") or ""
        for m in re.finditer(r"^\s*server_name\s+([^;]+);", txt, re.M):
            for name in m.group(1).split():
                found.setdefault(name, "nginx")
    for f in ["/etc/caddy/Caddyfile"] + glob.glob("/etc/caddy/*.caddy") + glob.glob("/etc/caddy/conf.d/*"):
        depth = 0
        for line in (read(f, "") or "").splitlines():
            s = line.split("#", 1)[0].strip()
            if depth == 0 and s.endswith("{") and not s.startswith(("(", "{")):
                for name in s[:-1].replace(",", " ").split():
                    found.setdefault(re.sub(r"^https?://", "", name).split(":")[0], "caddy")
            depth += s.count("{") - s.count("}")
    for c in containers:
        for k, v in ((c.get("Config") or {}).get("Labels") or {}).items():
            if k.startswith("traefik.http.routers.") and k.endswith(".rule"):
                for hm in re.finditer(r"Host\(([^)]*)\)", v):
                    for name in re.findall(r"`([^`]+)`", hm.group(1)):
                        found.setdefault(name, "traefik")
    clean = {}
    for name, srv in found.items():
        name = name.strip().lower().rstrip(".")
        if not name or name in ("_", "localhost") or "*" in name or name.startswith("~") or "$" in name:
            continue
        try:
            ipaddress.ip_address(name)
            continue
        except ValueError:
            pass
        if "." not in name:
            continue
        clean[name] = srv
    return clean


def cert_renewal_timer():
    for unit in ("certbot.timer", "snap.certbot.renew.timer"):
        if (run(["systemctl", "is-active", unit], timeout=10, ok_codes=(0, 3)) or "").strip() == "active":
            return True
    return False


def check_domain(name, server, expected_ips, certbot):
    res = {"domain": name, "server": server, "resolves_to": None, "resolves_ok": False, "https_ok": False,
           "http_status": None, "cert_days_left": None, "renewal_ok": None}
    try:
        infos = socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return res
    addrs = sorted({i[4][0] for i in infos}, key=lambda a: (":" in a, a))
    res["resolves_to"] = addrs[0] if addrs else None
    ok = False
    for a in addrs:
        try:
            ip = ipaddress.ip_address(a)
        except ValueError:
            continue
        if a in expected_ips or any(ip in n for n in CLOUDFLARE if ip.version == n.version):
            ok = True
    res["resolves_ok"] = ok
    issuer = ""
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((name, 443), timeout=8) as sock:
            with ctx.wrap_socket(sock, server_hostname=name) as ss:
                cert = ss.getpeercert()
        exp = ssl.cert_time_to_seconds(cert["notAfter"])
        res["cert_days_left"] = int((exp - time.time()) // 86400)
        issuer = " ".join(v for rdn in cert.get("issuer", ()) for (_, v) in rdn)
        conn = http.client.HTTPSConnection(name, 443, timeout=10, context=ctx)
        conn.request("GET", "/", headers={"User-Agent": "pixtaha-collector/" + VERSION, "Range": "bytes=0-0"})
        resp = conn.getresponse()
        res["http_status"] = resp.status
        resp.read(1024)
        conn.close()
        res["https_ok"] = res["http_status"] < 500
    except (OSError, ssl.SSLError, http.client.HTTPException, KeyError, ValueError):
        pass
    if server in ("caddy", "traefik"):
        res["renewal_ok"] = True
    elif certbot:
        res["renewal_ok"] = True
    if res["cert_days_left"] is not None and res["cert_days_left"] < 25 and ("Let's Encrypt" in issuer or res["renewal_ok"]):
        res["renewal_ok"] = False
    return res


def build_domains(containers, expected_ips):
    names = domains_from_configs(containers)
    if not names:
        return []
    certbot = cert_renewal_timer()
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(lambda kv: check_domain(kv[0], kv[1], expected_ips, certbot), sorted(names.items())))
    return out


# --------------------------------------------------------------------------- attention + changes

def build_attention(kpis, mem, disk, cont_items, cont_block, n8n_insts, dbs, domains, sec, backups, scripts, new_ports, fw_active):
    att = []

    def add(check, sev, title, impact, action, key=None):
        # `key` stays the same while the problem lasts (titles carry counts that change day to day)
        att.append({"id": check, "key": key or check, "severity": sev, "title": title, "impact": impact, "action": action})

    def names(lst, n=5):
        lst = list(lst)
        return ", ".join(lst[:n]) + (" and %d more" % (len(lst) - n) if len(lst) > n else "")

    # host
    days = kpis.get("disk_days_until_full")
    dp = disk["used_pct"] or 0
    if dp >= 90 or (days is not None and days <= 3):
        add("host.disk", "critical", "Disk is %s%% full" % dp, "The server stops writing data when the disk fills up.",
            "Free space now: old images, logs, backups.")
    elif dp >= 80 or (days is not None and days <= 14):
        add("host.disk", "warning", "Disk is %s%% full" % dp, "Growth will fill the disk%s." % (" in %d days" % days if days is not None else ""),
            "Plan a cleanup or a bigger disk.")
    rp = kpis.get("ram_peak_pct") or 0
    if mem["swap_used_mb"] > 0 and rp >= 95:
        add("host.ram", "critical", "RAM is exhausted (peak %s%%) and swap is in use" % rp, "Services slow down and can be killed.", "Find the largest containers and set memory limits.")
    elif rp >= 90:
        add("host.ram", "warning", "RAM peaked at %s%%" % rp, "Little headroom for spikes.", "Check the largest containers.")

    # containers
    oom = [x["name"] for x in cont_items if x["oom_kills_24h"]]
    if oom:
        add("containers.oom", "critical", "%d container%s killed for memory: %s" % (len(oom), "s" if len(oom) > 1 else "", names(oom)),
            "Work in progress was lost when the kernel killed the process.", "Raise the memory limit or reduce the load.")
    crashed = [x for x in cont_items if x.get("issue")]
    many = [x["name"] for x in cont_items if x["restarts_24h"] >= 3]
    if many:
        add("containers.restarts", "warning", "%s restarted 3+ times in 24h" % names(many), "Repeated crashes interrupt users and lose running work.", "Read the container logs and fix the cause.")
    for x in crashed:
        if x["name"] not in many and not x["oom_kills_24h"]:
            add("containers.restarts", "warning", "%s crashed and restarted" % x["name"], x["issue"] + ". Running executions were lost.", "Raise the memory limit or Node heap size.",
                key="containers.restarts:" + x["name"])
    unp = [x["name"] for x in cont_items if not x["pinned"] and x["state"] == "running"]
    if unp:
        add("containers.unpinned", "warning", "%d %s unpinned images" % (len(unp), "containers use" if len(unp) > 1 else "container uses"),
            "%s can change version on the next pull or recreate." % names(unp), "Pin exact image versions.")
    nl = [x["name"] for x in cont_items if x["mem_limit_mb"] is None and x["_app"] and x["state"] == "running"]
    if nl:
        add("containers.no_memory_limit", "warning", "%d %s no memory limit" % (len(nl), "app containers have" if len(nl) > 1 else "app container has"),
            "%s can use all RAM and starve the server." % names(nl), "Set mem_limit on each.")

    # ports
    dbp = sorted({p["port"] for p in sec["public_ports"] if p["is_database"] and not p.get("restricted_to")})
    # ports limited by DOCKER-USER to known sources carry restricted_to and are not flagged
    if dbp:
        add("ports.public_database", "critical" if not fw_active else "warning",
            "Database port%s %s open on all interfaces" % ("s" if len(dbp) > 1 else "", " and ".join(map(str, dbp))),
            "Database logins are reachable from the internet" + ("; the host firewall is off." if not fw_active else "."),
            "Bind database ports to 127.0.0.1 or allow only known IPs.")
    if new_ports:
        add("ports.new_public", "warning", "New public port%s: %s" % ("s" if len(new_ports) > 1 else "", ", ".join(map(str, new_ports))),
            "These ports were not open in the previous report.", "Confirm they are expected.")

    # domains
    bad_dns = [d["domain"] for d in domains if not d["resolves_ok"]]
    if bad_dns:
        add("domains.dns", "critical", "%d %s not resolve to this server" % (len(bad_dns), "domains do" if len(bad_dns) > 1 else "domain does"),
            "%s cannot be reached by users or webhooks." % names(bad_dns), "Fix the DNS records.")
    down = [d["domain"] for d in domains if d["resolves_ok"] and not d["https_ok"]]
    if down:
        add("domains.cert", "critical", "HTTPS fails on %s" % names(down), "Users see an error or a certificate warning.", "Check the certificate and the upstream service.",
            key="domains.https")
    exp = [d for d in domains if d["cert_days_left"] is not None and (d["cert_days_left"] <= 21 or d["renewal_ok"] is False)]
    if exp:
        worst_days = min(d["cert_days_left"] for d in exp)
        add("domains.cert", "critical" if worst_days <= 7 else "warning",
            "Certificate expires in %d days: %s" % (worst_days, names([d["domain"] for d in exp])),
            "Automatic renewal looks stuck.", "Run a certbot dry-run and check DNS.", key="domains.cert_expiry")

    # security
    if sec["ssh_password_auth"]:
        add("security.ssh_password", "critical",
            "SSH password login is enabled" + (" and root may log in with a password" if sec["ssh_root_login"] == "yes" else ""),
            "%s failed SSH logins in 24h. One guessed password gives control of the server." % (
                "{:,}".format(sec["failed_logins_24h"]) if sec["failed_logins_24h"] is not None else "Unknown number of"),
            "Switch to SSH keys, disable password login, install fail2ban.")
    if fw_active is False:
        add("security.firewall", "warning", "Host firewall is inactive", "Every published port is reachable from the internet.", "Enable ufw for 22, 80, 443 only.")
    if sec["tmp_executables"]:
        add("security.tmp_executables", "critical", "%d executable file%s in /tmp" % (sec["tmp_executables"], "s" if sec["tmp_executables"] > 1 else ""),
            "A common sign of a compromise.", "Inspect them now.")
    if sec["unknown_login_ips"]:
        add("security.unknown_login", "warning", "SSH login from %d new IP%s" % (len(sec["unknown_login_ips"]), "s" if len(sec["unknown_login_ips"]) > 1 else ""),
            ", ".join(sec["unknown_login_ips"][:5]), "Confirm these logins are yours.")

    # n8n
    for i in n8n_insts:
        if (i["executions_failed_24h"] or 0) >= 5:
            add("n8n.failed_executions", "warning", "%s: %d failed executions" % (i["name"], i["executions_failed_24h"]),
                "Some workflows did not finish in the last 24h.", "Open the executions list and fix the failing workflow.",
                key="n8n.failed_executions:" + i["name"])
        if (i["db_size_mb"] or 0) > 1024 or (i["db_growth_mb_24h"] or 0) > 100:
            add("n8n.db_growth", "warning", "%s SQLite database is %.1f GB" % (i["name"], (i["db_size_mb"] or 0) / 1024),
                "Large SQLite files slow n8n down and make backups heavy.", "Prune executions and VACUUM in a quiet window.",
                key="n8n.db_growth:" + i["name"])

    # backups
    if not backups:
        add("backups.age", "critical", "No backups found on this server", "A disk failure or a bad change cannot be undone.", "Schedule daily backups and copy them off the server.",
            key="backups.none")
    else:
        old = [b for b in backups if b["status"] in ("warning", "critical")]
        nodb = [d["name"] for d in dbs if d["last_backup_at"] is None and d["engine"] != "Redis"]
        stale = [d["name"] for d in dbs if d["last_backup_at"] and (now_utc() - parse_iso(d["last_backup_at"])).total_seconds() > 48 * 3600]
        if stale:
            add("backups.age", "warning", "Database backup older than 48 hours: %s" % names(stale, 3),
                "A restore would lose the changes since the last copy.", "Check the backup schedule.", key="backups.db_stale")
        if old:
            sev = "critical" if any(b["status"] == "critical" for b in old) else "warning"
            add("backups.age", sev, "Backups are out of date: %s" % names([b["name"] for b in old], 3),
                "The newest copy is older than %s." % ("7 days" if sev == "critical" else "48 hours"), "Fix or schedule the backup job.",
                key="backups.folders_stale")
        if nodb:
            add("backups.age", "critical", "%d %s no backup" % (len(nodb), "databases have" if len(nodb) > 1 else "database has"),
                "%s cannot be restored after a failure." % names(nodb), "Add them to the daily backup job.", key="backups.db_missing")
    failed_jobs = [s["name"] for s in scripts if s["last_result"] == "failed"]
    if failed_jobs:
        add("scripts.failed", "critical" if any("backup" in n for n in failed_jobs) else "warning",
            "Scheduled job failed: %s" % names(failed_jobs), "Its last run did not succeed.", "Check its logs.")

    att.sort(key=lambda a: SEV_RANK.get(a["severity"], 9))
    return att


def snapshot(cont_items, public_ports, boot_at):
    return {
        "containers": {x["name"]: "%s:%s" % (x["image"], x["tag"] or "latest") for x in cont_items},
        "ports": sorted({p["port"] for p in public_ports}),
        "boot_at": boot_at,
    }


def diff_changes(prev, cur, at):
    if not prev:
        return [], []
    ch = []
    pc, cc = prev.get("containers", {}), cur["containers"]
    for n in sorted(set(cc) - set(pc)):
        ch.append({"type": "container_added", "entity": n, "from": None, "to": cc[n], "at": at})
    for n in sorted(set(pc) - set(cc)):
        ch.append({"type": "container_removed", "entity": n, "from": pc[n], "to": None, "at": at})
    for n in sorted(set(pc) & set(cc)):
        if pc[n] != cc[n]:
            ch.append({"type": "image_changed", "entity": n, "from": pc[n], "to": cc[n], "at": at})
    pp, cp = set(prev.get("ports", [])), set(cur["ports"])
    new_ports = sorted(cp - pp)
    for p in new_ports:
        ch.append({"type": "port_opened", "entity": "port %d" % p, "from": None, "to": str(p), "at": at})
    for p in sorted(pp - cp):
        ch.append({"type": "port_closed", "entity": "port %d" % p, "from": str(p), "to": None, "at": at})
    if prev.get("boot_at") and cur["boot_at"] and abs((parse_iso(cur["boot_at"]) - parse_iso(prev["boot_at"])).total_seconds()) > 120:
        ch.append({"type": "reboot", "entity": "server", "from": None, "to": None, "at": cur["boot_at"]})
    return ch, new_ports


# --------------------------------------------------------------------------- report

def build_report(cfg, end=None):
    end = end or now_utc()
    start = end - dt.timedelta(hours=24)
    state = load_json("state.json", {})
    hostname = cfg.get("PIXTAHA_HOSTNAME") or socket.gethostname()
    mem, disk = meminfo(), disk_root()
    up = uptime_seconds()
    ips = host_ips()
    pub = public_ipv4(cfg, ips)
    expected = set(ips) | ({pub} if pub else set()) | set(filter(None, (cfg.get("PIXTAHA_EXTRA_IPS") or "").split(",")))
    samples = load_samples(start, end)
    kpis = build_kpis(samples, start, end, mem, disk, state)

    containers, has_docker = [], docker_available()
    if has_docker:
        containers = docker_inspect_all()
    oom_by_id, _ = kernel_oom_by_container() if has_docker else ({}, 0)
    stats = docker_stats() if containers else {}
    cont_block, cont_items, mem_limits = build_containers(containers, samples, oom_by_id, stats, start) if has_docker else (None, [], {})
    n8n_insts, n8n_sizes = build_n8n(containers, start, state, mem_limits)
    backups, backup_files = scan_backups(cfg)
    dbs = build_databases(containers, n8n_insts, backup_files)
    scripts, services, units = build_scripts_services()

    # public listeners not owned by docker or standard daemons
    lst = listeners()
    public_ports = {}
    for port, bind, proc, pid, public in lst:
        if not public:
            continue
        public_ports.setdefault(port, {"port": port, "proto": "tcp", "bind": "0.0.0.0", "owner": proc or "unknown", "is_database": port in DB_PORTS})
        if proc and proc not in QUIET_LISTENERS and pid:
            if not any(s["port"] == port for s in services):
                services.append({"name": proc, "kind": "api", "status": "warning" if pid_user(pid) == "root" else "healthy",
                                 "state": "running", "user": pid_user(pid), "port": port, "public": True, "latency_ms": None})
    restricted = docker_user_restrictions() if has_docker else {}
    for x in cont_items:
        for p in x["ports"]:
            if p["public"]:
                public_ports[p["port"]] = {"port": p["port"], "proto": "tcp", "bind": "0.0.0.0", "owner": x["name"], "is_database": p["port"] in DB_PORTS}
                if p["port"] in restricted:
                    public_ports[p["port"]]["restricted_to"] = len(restricted[p["port"]])

    pw, root_login = sshd_settings()
    failed, methods, login_ips = scan_auth(cfg, start)
    known = set(state.get("known_login_ips", []))
    unknown = sorted(login_ips - known) if known else []
    fw = firewall_active()
    upd_total, upd_sec = pending_updates()
    sec = {
        "ssh_password_auth": pw, "ssh_root_login": root_login, "failed_logins_24h": failed,
        "firewall_active": fw, "unknown_login_ips": unknown, "tmp_executables": tmp_executables(),
        "pending_updates": upd_total, "pending_security_updates": upd_sec,
        "reboot_required": os.path.exists("/var/run/reboot-required"),
        "public_ports": sorted(public_ports.values(), key=lambda p: p["port"]),
    }
    domains = build_domains(containers, expected)

    boot_at = iso(end - dt.timedelta(seconds=up)) if up else None
    snap = snapshot(cont_items, sec["public_ports"], boot_at)
    changes, new_ports = diff_changes(state.get("snapshot"), snap, iso(end))
    att = build_attention(kpis, mem, disk, cont_items, cont_block, n8n_insts, dbs, domains, sec, backups, scripts, new_ports, fw)
    sevs = [a["severity"] for a in att]
    overall = worst(sevs) if sevs else "healthy"
    if overall in ("info", "unknown"):
        overall = "healthy"

    cairo_date = (end + dt.timedelta(hours=2)).strftime("%Y-%m-%d")
    blocks = {"security": sec, "systemd_units": units}
    if cont_block is not None:
        blocks["containers"] = cont_block
    if n8n_insts:
        blocks["n8n"] = {"instances": n8n_insts}
    if scripts:
        blocks["scripts"] = scripts
    if services:
        blocks["services"] = services
    if dbs:
        blocks["databases"] = dbs
    if domains:
        blocks["domains"] = domains
    if backups:
        blocks["backups"] = backups
    payload = {
        "schema_version": SCHEMA,
        "report": {
            "id": "%s-%s" % (hostname, cairo_date), "type": "daily",
            "generated_at": iso(end), "period_start": iso(start), "period_end": iso(end),
            "collector_version": VERSION, "samples": len(samples),
        },
        "server": {
            "hostname": hostname, "client": cfg.get("PIXTAHA_CLIENT", "Unknown"), "env": cfg.get("PIXTAHA_ENV", "production"),
            "public_ip": pub, "os": os_release(), "kernel": os.uname().release, "cores": os.cpu_count(),
            "ram_total_mb": mem["total_mb"], "swap_total_mb": mem["swap_total_mb"], "disk_total_gb": disk["total_gb"],
            "uptime_seconds": up, "dashboard_url": cfg.get("PIXTAHA_DASHBOARD_URL") or None,
        },
        "status": {"overall": overall, "critical": sevs.count("critical"), "warning": sevs.count("warning"), "info": sevs.count("info")},
        "kpis": kpis,
        "attention": att,
        "changes": changes,
        "blocks": blocks,
    }
    new_state = {
        "snapshot": snap,
        "n8n_db_mb": n8n_sizes,
        "known_login_ips": sorted(known | login_ips),
        "disk_history": (state.get("disk_history", []) + [{"t": end.timestamp(), "gb": disk["used_gb"]}])[-30:],
    }
    return payload, state, new_state


def post_json(url, token, body, attempts=3, backoff=60):
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    if len(data) > 512 * 1024:
        raise RuntimeError("payload is %d KB, over the 512 KB limit" % (len(data) // 1024))
    last = None
    for i in range(attempts):
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "Content-Type": "application/json", "X-Report-Token": token,
            "User-Agent": "pixtaha-collector/" + VERSION,
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code in (401, 403):
                return e.code
        except (urllib.error.URLError, OSError) as e:
            last = str(getattr(e, "reason", e))
        if i < attempts - 1:
            time.sleep(backoff)
    raise RuntimeError("webhook failed after %d attempts: %s" % (attempts, last))


# --------------------------------------------------------------------------- real-time critical alerts

ALERT_FILE = "alerts.json"
ALERT_CAP = 10              # max alerts (and max resolved) per POST
ALERT_DEBOUNCE = 2          # samples a condition must hold before it is sent
RESOLVE_AFTER = 2           # samples a sent alert must be gone before "resolved" is sent
OOM_HOLD_S = 1800           # an OOM kill stays an active condition for 30 min
DOMAIN_EVERY_S = 900        # domain checks at most every 15 min
DOMAIN_BUDGET_S = 6         # wall-clock budget for one round of domain checks
ESSENTIAL = re.compile(r"(^|[/_.-])n8n([_.:-]|$)")


def alert_url(cfg):
    if cfg.get("PIXTAHA_ALERT_URL"):
        return cfg["PIXTAHA_ALERT_URL"]
    base = cfg.get("PIXTAHA_WEBHOOK_URL") or ""
    return base.replace("server-daily-report", "server-alert") if "server-daily-report" in base else None


def is_essential(c):
    """n8n or database container: expected to be running all the time."""
    image = ((c.get("Config") or {}).get("Image") or "").lower()
    name = (c.get("Name") or "").lstrip("/").lower()
    return bool(ESSENTIAL.search(image) or ESSENTIAL.search(name) or DB_IMAGE.search(image.split("@")[0]))


def recent_oom_ids(minutes=10):
    txt = run(["journalctl", "-k", "--since", "-%dmin" % minutes, "--no-pager", "-o", "cat"], timeout=5) or ""
    ids = set()
    for line in txt.splitlines():
        if "oom-kill:" in line:
            m = re.search(r"docker[-/]([0-9a-f]{64})", line)
            if m:
                ids.add(m.group(1))
    return ids


def failed_units():
    out = run(["systemctl", "list-units", "--state=failed", "--no-legend", "--plain"], timeout=5)
    if out is None:
        return None
    return sorted({l.split()[0] for l in out.splitlines() if l.strip() and not l.startswith("0 ")})


def quick_domain_ok(name):
    """True if the domain resolves and answers HTTPS with a valid certificate and a status below 500."""
    try:
        socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        return False, "does not resolve"
    try:
        ctx = ssl.create_default_context()
        conn = http.client.HTTPSConnection(name, 443, timeout=4, context=ctx)
        conn.request("HEAD", "/", headers={"User-Agent": "pixtaha-collector/" + VERSION})
        status = conn.getresponse().status
        conn.close()
    except ssl.SSLError:
        return False, "HTTPS certificate error"
    except (OSError, http.client.HTTPException):
        return False, "HTTPS does not answer"
    return (status < 500), ("HTTP %d" % status)


def domain_conditions(cfg, cs, st, now):
    """Checks domains at most every 15 min; a domain must fail 2 checks in a row. Returns {key: alert}."""
    dom = st.setdefault("domains", {"checked_at": 0, "fails": {}, "detail": {}})
    if (cfg.get("PIXTAHA_ALERT_DOMAINS") or "on").lower() in ("off", "0", "no", "false"):
        return {}
    if now - dom.get("checked_at", 0) >= DOMAIN_EVERY_S:
        names = sorted(domains_from_configs(cs))[:30]
        dom["checked_at"] = now
        if names:
            ex = ThreadPoolExecutor(max_workers=8)
            futs = {n: ex.submit(quick_domain_ok, n) for n in names}
            deadline = time.time() + DOMAIN_BUDGET_S
            fails, detail = {}, {}
            for n, f in futs.items():
                try:
                    ok, why = f.result(timeout=max(0.1, deadline - time.time()))
                except Exception:
                    ok, why = None, None  # no answer within the budget: unknown, keep the previous count
                if ok is None:
                    if n in dom["fails"]:
                        fails[n], detail[n] = dom["fails"][n], dom["detail"].get(n, "")
                elif not ok:
                    fails[n], detail[n] = dom["fails"].get(n, 0) + 1, why
            ex.shutdown(wait=False)
            dom["fails"], dom["detail"] = fails, detail
        else:
            dom["fails"], dom["detail"] = {}, {}
    return {"domain.down:" + n: {"severity": "critical", "title": "Domain %s is down" % n,
                                 "detail": dom["detail"].get(n) or "HTTPS check failed"}
            for n, k in dom["fails"].items() if k >= 2}


def alert_conditions(cfg, sample, cs, st, now):
    """Current critical conditions as {key: {severity, title, detail}}. Names and numbers only, no secrets."""
    cur = {}

    def add(key, title, detail):
        cur[key] = {"severity": "critical", "title": title, "detail": detail}

    disk = sample.get("disk")
    if disk is not None and disk >= 90:
        add("host.disk", "Disk %d%% full" % int(disk), "Root filesystem %.1f%% used (%s GB)." % (disk, sample.get("disk_gb")))
    ram, swap = sample.get("ram"), sample.get("swap_mb") or 0
    if ram is not None and ram >= 95 and swap > 0:
        add("host.ram", "RAM %d%% with swap in use" % int(ram), "RAM %.1f%% used, %d MB swap in use." % (ram, swap))

    # containers
    seen_running = set(st.get("running", []))
    oom_ids = recent_oom_ids() if cs else set()
    oom_hold = {k: v for k, v in st.get("oom", {}).items() if now - v < OOM_HOLD_S}
    oom_marks = st.get("oom_marks", {})
    names_now = set()
    for c in cs:
        name = (c.get("Name") or "").lstrip("/")
        stt = c.get("State") or {}
        status = stt.get("Status")
        names_now.add(name)
        if stt.get("OOMKilled") or c.get("Id") in oom_ids:
            mark = "%s|%s" % (stt.get("StartedAt"), stt.get("FinishedAt"))  # one alert per kill, not per sample
            if oom_marks.get(name) != mark:
                oom_marks[name] = mark
                oom_hold[name] = now
        if status == "running":
            seen_running.add(name)
            continue
        policy = ((c.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name") or "no"
        bad = status in ("exited", "dead", "restarting")
        if bad and (name in seen_running or (is_essential(c) and policy != "no")):
            what = "n8n / database container" if is_essential(c) else "Container"
            add("container.down:" + name, "%s %s is %s" % (what, name, status),
                "State %s, exit code %s, restarts %s." % (status, stt.get("ExitCode"), c.get("RestartCount", 0)))
    for name, at in oom_hold.items():
        add("container.oom:" + name, "Container %s was OOM-killed" % name,
            "Out of memory kill at %s." % iso(at))
    st["running"] = sorted(seen_running & names_now)  # forget removed containers
    st["oom"] = oom_hold
    st["oom_marks"] = {k: v for k, v in oom_marks.items() if k in names_now}

    # systemd: only units that failed after the collector started watching
    units = failed_units()
    if units is not None:
        if "units_baseline" not in st:
            st["units_baseline"] = units
        base = set(st["units_baseline"]) & set(units)  # a baseline unit that recovers is watched again
        st["units_baseline"] = sorted(base)
        for u in units:
            if u not in base:
                add("unit.failed:" + u, "Service %s failed" % u, "systemd unit %s is in failed state." % u)

    cur.update(domain_conditions(cfg, cs, st, now))
    return cur


def plan_alerts(st, cur, now):
    """Debounce + dedupe. Mutates counters in st; returns (alerts, resolved) to send. Sent state is applied
    only after a successful POST (commit_alerts), so a failed POST is retried by the next sample."""
    streak, sent, gone = st.setdefault("streak", {}), st.setdefault("sent", {}), st.setdefault("gone", {})
    for k in list(streak):
        if k not in cur:
            del streak[k]
    for k in cur:
        streak[k] = streak.get(k, 0) + 1
        gone.pop(k, None)
    for k in sent:
        if k not in cur:
            gone[k] = gone.get(k, 0) + 1
    for k in list(gone):
        if k not in sent:
            del gone[k]
    alerts = [dict(key=k, **cur[k]) for k in sorted(cur) if streak[k] >= ALERT_DEBOUNCE and k not in sent][:ALERT_CAP]
    resolved = [{"key": k, "title": sent[k]["title"]} for k in sorted(gone) if gone[k] >= RESOLVE_AFTER][:ALERT_CAP]
    return alerts, resolved


def commit_alerts(st, alerts, resolved, at):
    for a in alerts:
        st["sent"][a["key"]] = {"title": a["title"], "at": at}
    for r in resolved:
        st["sent"].pop(r["key"], None)
        st["gone"].pop(r["key"], None)


def post_alert(url, token, body):
    """One try, 10 s timeout. Returns the HTTP status or None."""
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json", "X-Report-Token": token, "User-Agent": "pixtaha-collector/" + VERSION})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError, ValueError):
        return None


def run_alerts(cfg, sample, cs):
    now = time.time()
    with StateLock():
        st = load_json(ALERT_FILE, {})
        cur = alert_conditions(cfg, sample, cs, st, now)
        alerts, resolved = plan_alerts(st, cur, now)
        save_json(ALERT_FILE, st)
    at = iso(now)
    body = {"schema_version": SCHEMA, "hostname": cfg.get("PIXTAHA_HOSTNAME") or socket.gethostname(),
            "client": cfg.get("PIXTAHA_CLIENT", "Unknown"), "env": cfg.get("PIXTAHA_ENV", "production"),
            "at": at, "collector": VERSION, "heartbeat": True, "alerts": alerts, "resolved": resolved}
    url, token = alert_url(cfg), cfg.get("PIXTAHA_REPORT_TOKEN")
    if not url or not token:
        log("alerts: no alert URL or token, heartbeat not sent (%d active)" % len(cur))
        return
    code = post_alert(url, token, body)
    if code and 200 <= code < 300:
        with StateLock():
            st = load_json(ALERT_FILE, {})
            st.setdefault("sent", {})
            st.setdefault("gone", {})
            commit_alerts(st, alerts, resolved, at)
            st["last_post"] = {"at": at, "http": code}
            save_json(ALERT_FILE, st)
    log("heartbeat: HTTP %s, %d active, %d new alerts, %d resolved" % (code, len(cur), len(alerts), len(resolved)))


# --------------------------------------------------------------------------- live dashboard (1.2.0+)
# The `live` service pushes a small snapshot every 5 s straight to the Supabase REST API
# (public.sm_live, authenticated with the report token). Refresh reports (full checks, no email)
# go to public.sm_push_report every 5 minutes and when the hub asks for a re-check.

LIVE_EVERY_S = 5
LIVE_CONTAINERS_EVERY_S = 15
LIVE_FILE = "live.json"


def live_target(cfg):
    url = (cfg.get("PIXTAHA_LIVE_URL") or "").strip().rstrip("/")
    key = (cfg.get("PIXTAHA_LIVE_KEY") or "").strip()
    token = cfg.get("PIXTAHA_REPORT_TOKEN") or ""
    if not (url.startswith("https://") or url.startswith("http://127.0.0.1:")) or not key or not token:  # http only for local tests
        return None
    return url, key, token


def rpc_post(target, fn, args, timeout=5, limit_kb=512):
    """POST to /rest/v1/rpc/<fn>. Returns (http status or None, parsed JSON or None)."""
    url, key, _token = target
    data = json.dumps(args, separators=(",", ":")).encode("utf-8")
    if len(data) > limit_kb * 1024:
        return 413, None
    req = urllib.request.Request("%s/rest/v1/rpc/%s" % (url, fn), data=data, method="POST", headers={
        "Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + key,
        "User-Agent": "pixtaha-collector/" + VERSION})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            try:
                return r.status, json.loads(body.decode("utf-8")) if body else None
            except ValueError:
                return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError, ValueError):
        return None, None


def live_containers():
    """[(name, state)] from one cheap `docker ps`, or None without docker."""
    if not shutil.which("docker"):
        return None
    out = run(["docker", "ps", "-a", "--no-trunc", "--format", "{{.Names}}\t{{.State}}"], timeout=10)
    if out is None:
        return None
    items = []
    for line in out.splitlines():
        name, _, state = line.partition("\t")
        if name:
            items.append((name.strip(), (state or "").strip().lower()))
    return sorted(items)


def loadavg1():
    try:
        return float((read("/proc/loadavg", "") or "").split()[0])
    except (IndexError, ValueError):
        return None


def live_snapshot(cfg, cpu, conts):
    mem, disk, up = meminfo(), disk_root(), uptime_seconds()
    snap = {
        "hostname": cfg.get("PIXTAHA_HOSTNAME") or socket.gethostname(), "collector": VERSION,
        "cpu": cpu, "ram": round(100.0 * mem["used_mb"] / mem["total_mb"], 1) if mem["total_mb"] else None,
        "ram_mb": mem["used_mb"], "ram_total_mb": mem["total_mb"], "swap_mb": mem["swap_used_mb"],
        "disk": disk["used_pct"], "disk_gb": disk["used_gb"], "disk_total_gb": disk["total_gb"],
        "load1": loadavg1(), "cores": os.cpu_count(),
        "boot_at": iso(time.time() - up) if up else None,
    }
    if conts is not None:
        snap["running"] = sum(1 for _, st in conts if st == "running")
        snap["total"] = len(conts)
        snap["containers"] = [{"n": n[:80], "s": st[:12]} for n, st in conts[:200]]
    return snap


def start_refresh():
    """Ask systemd for one refresh report (single instance); fall back to a detached process."""
    if shutil.which("systemctl") and os.path.isdir("/run/systemd/system"):
        if run(["systemctl", "start", "--no-block", "pixtaha-collector-refresh.service"], timeout=10) is not None:
            return True
    try:
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "report", "--refresh"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True
    except OSError:
        return False


def cmd_live(args):
    cfg = load_config()
    target = live_target(cfg)
    if not target:
        log("live: PIXTAHA_LIVE_URL (https) and PIXTAHA_LIVE_KEY are not set, live updates are off")
        return
    try:
        every = min(60, max(2, int(cfg.get("PIXTAHA_LIVE_INTERVAL") or LIVE_EVERY_S)))
    except ValueError:
        every = LIVE_EVERY_S
    log("live: every %d s to %s" % (every, target[0]))
    prev = cpu_counters()
    time.sleep(1)
    conts, conts_at, fails, last_note, last_save, n = None, 0.0, 0, 0.0, 0.0, 0
    while True:
        t0 = time.time()
        cnt = cpu_counters()
        cpu, prev = cpu_pct_between(prev, cnt), cnt
        if t0 - conts_at >= LIVE_CONTAINERS_EVERY_S:
            conts, conts_at = live_containers(), t0
        code, res = rpc_post(target, "sm_live", {"p_token": target[2], "p": live_snapshot(cfg, cpu, conts)})
        ok = code is not None and 200 <= code < 300 and isinstance(res, dict) and res.get("ok")
        if ok:
            fails = 0
            if res.get("recheck"):
                log("live: re-check asked by the hub, starting a refresh report")
                start_refresh()
        else:
            fails += 1
            if t0 - last_note >= 300:
                last_note = t0
                reason = (res or {}).get("reason") if isinstance(res, dict) else None
                log("live: push failed (HTTP %s%s), retrying" % (code, ", " + reason if reason else ""))
        if t0 - last_save >= 60:
            last_save = t0
            save_json(LIVE_FILE, {"at": iso(t0), "http": code, "ok": bool(ok), "every": every})
        n += 1
        if args.once:
            return
        wait = every if fails == 0 else min(60, every * (2 ** min(fails, 4)))
        time.sleep(max(0.5, wait - (time.time() - t0)))


def send_refresh(cfg, args):
    target = live_target(cfg)
    if not target and not (args.dry_run or args.out):
        log("refresh: PIXTAHA_LIVE_URL and PIXTAHA_LIVE_KEY are not set, nothing to send")
        return
    payload, _old, _new = build_report(cfg)  # read-only: refresh reports never move the daily baseline
    now = now_utc()
    payload["report"]["type"] = "refresh"
    payload["report"]["id"] = "%s-refresh-%s" % (payload["server"]["hostname"], now.strftime("%Y%m%d%H%M%S"))
    if args.dry_run or args.out:
        return payload
    code, res = rpc_post(target, "sm_push_report", {"p_token": target[2], "p": payload}, timeout=60, limit_kb=2048)
    log("refresh %s: HTTP %s, status %s, %d attention items%s" % (
        payload["report"]["id"], code, payload["status"]["overall"], len(payload["attention"]),
        "" if code and 200 <= code < 300 else " (not stored)"))
    if not (code and 200 <= code < 300):
        sys.exit(1)
    return None


# --------------------------------------------------------------------------- CLI

def cmd_sample(_args):
    with StateLock():
        s, cs = take_sample()
    log("sample ok: cpu=%s ram=%s disk=%s containers=%d" % (s.get("cpu"), s.get("ram"), s.get("disk"), len(s.get("c") or [])))
    try:
        run_alerts(load_config(), s, cs)
    except Exception as e:  # alerts must never fail the sample
        log("alerts skipped: %s" % type(e).__name__)


def cmd_report(args):
    cfg = load_config()
    if args.refresh:
        payload = send_refresh(cfg, args)
        if payload is None:
            return
        new_state = None
    else:
        with StateLock():
            payload, _old, new_state = build_report(cfg)
    if args.id_suffix:
        payload["report"]["id"] += "-" + re.sub(r"[^a-z0-9-]", "", args.id_suffix.lower())
    if args.dry_run or args.out:
        text = json.dumps(payload, indent=2, ensure_ascii=False)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(text + "\n")
            log("payload written to %s (%d KB)" % (args.out, len(text) // 1024))
        else:
            print(text)
        return
    url, token = cfg.get("PIXTAHA_WEBHOOK_URL"), cfg.get("PIXTAHA_REPORT_TOKEN")
    if not url or not token:
        log("PIXTAHA_WEBHOOK_URL and PIXTAHA_REPORT_TOKEN must be set in %s" % CONFIG_FILE)
        sys.exit(2)
    code = post_json(url, token, payload)
    log("report %s sent: HTTP %s, status %s, %d attention items" % (
        payload["report"]["id"], code, payload["status"]["overall"], len(payload["attention"])))
    if code and isinstance(code, int) and 200 <= code < 300:
        with StateLock():
            save_json("state.json", new_state)
            save_json("last_report.json", {"id": payload["report"]["id"], "at": payload["report"]["generated_at"],
                                           "http": code, "status": payload["status"]["overall"]})
    else:
        sys.exit(1)


def cmd_status(_args):
    cfg = load_config()
    print("version:      " + VERSION)
    print("config:       " + CONFIG_FILE)
    for k in ("PIXTAHA_CLIENT", "PIXTAHA_ENV", "PIXTAHA_WEBHOOK_URL"):
        print("%-13s %s" % (k.replace("PIXTAHA_", "").lower() + ":", cfg.get(k, "(not set)")))
    print("token:        " + ("set" if cfg.get("PIXTAHA_REPORT_TOKEN") else "NOT SET"))
    lines = (read(os.path.join(STATE_DIR, "samples.jsonl"), "") or "").splitlines()
    print("samples:      %d (last %s)" % (len(lines), json.loads(lines[-1])["t"] if lines else "never"))
    last = load_json("last_report.json", None)
    print("last report:  " + ("%s at %s, HTTP %s, %s" % (last["id"], last["at"], last["http"], last["status"]) if last else "never"))
    al = load_json(ALERT_FILE, {})
    print("alert url:    " + (alert_url(cfg) or "(not set)"))
    lp = al.get("last_post")
    print("heartbeat:    " + ("%s, HTTP %s" % (lp["at"], lp["http"]) if lp else "never sent"))
    print("open alerts:  " + (", ".join(sorted(al.get("sent", {}))) or "none"))
    lt = live_target(cfg)
    lv = load_json(LIVE_FILE, None)
    print("live url:     " + (lt[0] if lt else "(not set, live dashboard off)"))
    print("live push:    " + ("%s, HTTP %s, %s" % (lv["at"], lv["http"], "ok" if lv.get("ok") else "FAILING") if lv else "never"))


def main():
    ap = argparse.ArgumentParser(prog="pixtaha-collector", description="Pixtaha Management read-only server collector")
    ap.add_argument("--version", action="version", version=VERSION)
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("sample", help="take one 5-minute sample")
    rp = sub.add_parser("report", help="build the daily payload and send it")
    rp.add_argument("--dry-run", action="store_true", help="print the payload, do not send, do not update state")
    rp.add_argument("--out", help="write the payload to a file instead of sending")
    rp.add_argument("--id-suffix", help="append to report.id (for a manual extra report on the same day)")
    rp.add_argument("--refresh", action="store_true", help="full checks for the live dashboard: no email, no state change")
    lp = sub.add_parser("live", help="push a live snapshot every 5 seconds (runs as a service)")
    lp.add_argument("--once", action="store_true", help="push one snapshot and exit")
    sub.add_parser("status", help="show config (without the token) and last runs")
    args = ap.parse_args()
    os.umask(0o077)
    if args.cmd == "sample":
        cmd_sample(args)
    elif args.cmd == "report":
        cmd_report(args)
    elif args.cmd == "live":
        cmd_live(args)
    elif args.cmd == "status":
        cmd_status(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
