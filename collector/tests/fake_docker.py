#!/usr/bin/env python3
"""Stand-in for the docker CLI, for tests only. Serves fictional fixtures from $FAKE_DOCKER_DIR."""
import json
import os
import sys

D = os.environ["FAKE_DOCKER_DIR"]
with open(os.path.join(D, "inspect.json")) as f:
    CONTAINERS = json.load(f)
a = sys.argv[1:]
if a[:1] == ["info"]:
    print("29.7.2")
elif a[:1] == ["ps"] and "--format" in a:
    for c in CONTAINERS:
        print("%s\t%s" % (c["Name"].lstrip("/"), c["State"]["Status"]))
elif a[:1] == ["ps"]:
    print("\n".join(c["Id"] for c in CONTAINERS))
elif a[:1] == ["inspect"]:
    ids = set(a[1:])
    print(json.dumps([c for c in CONTAINERS if c["Id"] in ids]))
elif a[:1] == ["stats"]:
    for c in CONTAINERS:
        if c["State"]["Status"] == "running":
            print(json.dumps({"Name": c["Name"].lstrip("/"), "CPUPerc": "1.25%", "MemUsage": "512.5MiB / 1GiB"}))
elif a[:1] == ["logs"]:
    if a[-1] == "n8n-heavy":
        sys.stderr.write("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n")
else:
    sys.exit(1)
