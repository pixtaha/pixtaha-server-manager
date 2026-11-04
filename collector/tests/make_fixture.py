#!/usr/bin/env python3
"""Builds a fictional docker fixture + n8n SQLite databases under the given directory. No real server data."""
import datetime as dt
import json
import os
import sqlite3
import sys

root = sys.argv[1]
now = dt.datetime.now(dt.timezone.utc)
recent = (now - dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S.000000000Z")
old = (now - dt.timedelta(days=12)).strftime("%Y-%m-%dT%H:%M:%S.000000000Z")


def n8n_db(name, wf, active, ok, failed):
    d = os.path.join(root, "volumes", name)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "database.sqlite")
    if os.path.exists(p):
        os.remove(p)
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE workflow_entity (id TEXT, name TEXT, active INTEGER, isArchived INTEGER)")
    con.execute("CREATE TABLE execution_entity (id INTEGER, status TEXT, startedAt TEXT)")
    for i in range(wf):
        con.execute("INSERT INTO workflow_entity VALUES (?,?,?,0)", (str(i), "wf%d" % i, 1 if i < active else 0))
    t = (now - dt.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S.000")
    t_old = (now - dt.timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S.000")
    for i in range(ok):
        con.execute("INSERT INTO execution_entity VALUES (?,?,?)", (i, "success", t))
    for i in range(failed):
        con.execute("INSERT INTO execution_entity VALUES (?,?,?)", (1000 + i, "error", t))
    con.execute("INSERT INTO execution_entity VALUES (?,?,?)", (9999, "success", t_old))
    con.commit()
    con.close()
    return d


def c(i, name, image, status="running", rc=0, started=old, mem=0, ports=None, env=None, mounts=None, labels=None, policy="unless-stopped", exit_code=0):
    return {
        "Id": ("%02d" % i) * 32, "Name": "/" + name, "RestartCount": rc,
        "State": {"Status": status, "StartedAt": started, "FinishedAt": "0001-01-01T00:00:00Z", "OOMKilled": False, "ExitCode": exit_code},
        "Config": {"Image": image, "Env": env or [], "Labels": labels or {}},
        "HostConfig": {"Memory": mem, "RestartPolicy": {"Name": policy}},
        "NetworkSettings": {"Ports": ports or {}},
        "Mounts": mounts or [],
    }


pub = lambda port: {"%d/tcp" % port: [{"HostIp": "0.0.0.0", "HostPort": str(port)}, {"HostIp": "::", "HostPort": str(port)}]}
loc = lambda port: {"%d/tcp" % port: [{"HostIp": "127.0.0.1", "HostPort": str(port)}]}
vol = lambda d: [{"Type": "volume", "Source": d, "Destination": "/home/node/.n8n"}]

cs = [
    c(1, "n8n-alpha", "docker.n8n.io/n8nio/n8n:2.33.4", mem=2048 * 1048576, ports=loc(5678),
      env=["N8N_VERSION=2.33.4", "N8N_HOST=alpha.example.com", "N8N_ENCRYPTION_KEY=do-not-leak"],
      mounts=vol(n8n_db("alpha", 12, 5, 340, 0)), labels={"com.docker.compose.project": "n8n-alpha"}),
    c(2, "n8n-heavy", "docker.n8n.io/n8nio/n8n", rc=1, started=recent, ports=pub(20001),
      env=["N8N_VERSION=2.37.10", "WEBHOOK_URL=https://heavy.example.com/", "DB_POSTGRESDB_PASSWORD=do-not-leak"],
      mounts=vol(n8n_db("heavy", 40, 9, 1200, 7))),
    c(3, "n8n-shared", "n8nio/n8n:latest", mem=1024 * 1048576,
      env=["N8N_VERSION=2.37.10", "DB_TYPE=postgresdb", "N8N_HOST=shared.example.com"],
      labels={"traefik.http.routers.shared.rule": "Host(`shared.example.com`)"}),
    c(4, "supabase-db", "supabase/postgres:17.6.1.136", mounts=[{"Source": os.path.join(root, "pgdata"), "Destination": "/var/lib/postgresql/data"}],
      labels={"com.docker.compose.project": "demo"}),
    c(5, "supabase-pooler", "supabase/supavisor:2.9.5", ports=dict(pub(5432), **pub(6543)), labels={"com.docker.compose.project": "demo"}),
    c(6, "rembg", "danielgatis/rembg", ports=pub(7000)),
    c(7, "n8n-alpha-old", "n8nio/n8n", status="exited", policy="no", exit_code=0),
]
os.makedirs(os.path.join(root, "pgdata"), exist_ok=True)
with open(os.path.join(root, "pgdata", "PG_VERSION"), "w") as f:
    f.write("17\n")
with open(os.path.join(root, "inspect.json"), "w") as f:
    json.dump(cs, f)
print("fixture ready:", root)
