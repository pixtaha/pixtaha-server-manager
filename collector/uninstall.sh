#!/usr/bin/env bash
# Removes the Pixtaha Management collector.
#   bash uninstall.sh           remove timers, units and program; keep config and state
#   bash uninstall.sh --purge   also remove /etc/pixtaha-collector and /var/lib/pixtaha-collector
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "error: run as root" >&2; exit 1; }

systemctl disable --now pixtaha-collector-sample.timer pixtaha-collector-report.timer \
  pixtaha-collector-refresh.timer pixtaha-collector-live.service 2>/dev/null || true
rm -f /etc/systemd/system/pixtaha-collector-sample.service /etc/systemd/system/pixtaha-collector-sample.timer \
      /etc/systemd/system/pixtaha-collector-report.service /etc/systemd/system/pixtaha-collector-report.timer \
      /etc/systemd/system/pixtaha-collector-refresh.service /etc/systemd/system/pixtaha-collector-refresh.timer \
      /etc/systemd/system/pixtaha-collector-live.service
systemctl daemon-reload
rm -f /usr/local/bin/pixtaha-collector
rm -f /opt/pixtaha-collector/pixtaha_collector.py /opt/pixtaha-collector/REF /opt/pixtaha-collector/uninstall.sh
rmdir /opt/pixtaha-collector 2>/dev/null || true

if [ "${1:-}" = "--purge" ]; then
  rm -f /etc/pixtaha-collector/config.env
  rmdir /etc/pixtaha-collector 2>/dev/null || true
  rm -f /var/lib/pixtaha-collector/samples.jsonl /var/lib/pixtaha-collector/state.json \
        /var/lib/pixtaha-collector/last_report.json /var/lib/pixtaha-collector/last_cpu.json \
        /var/lib/pixtaha-collector/alerts.json /var/lib/pixtaha-collector/live.json \
        /var/lib/pixtaha-collector/.lock
  rm -rf /var/lib/pixtaha-collector/docker
  rmdir /var/lib/pixtaha-collector 2>/dev/null || true
  echo "Collector removed, config and state purged."
else
  echo "Collector removed. Config kept in /etc/pixtaha-collector, state in /var/lib/pixtaha-collector."
fi
