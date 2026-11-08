#!/usr/bin/env bash
# Pixtaha Management collector installer.
#
# Installs a read-only monitor: /opt/pixtaha-collector, systemd units
# (5-minute sample, daily report at 08:55 Africa/Cairo, 5-minute refresh report and
# the live service for the dashboard) and a config file with the token (mode 600).
# It does not change anything else.
#
# Usage (as root):
#   curl -fsSL https://raw.githubusercontent.com/pixtaha/pixtaha-server-manager/<ref>/collector/install.sh -o /tmp/pixtaha-install.sh
#   bash /tmp/pixtaha-install.sh --ref <ref> --client "Client name" --env production --webhook https://<n8n-host>/webhook/server-daily-report
#   Live dashboard (1.2.0+): add --live-url https://<supabase-host> ; the Supabase anon key is asked for
#   without echo (or kept from the existing config).
# The token is asked for interactively and is never echoed or passed as an argument.
set -euo pipefail

REF="main"
CLIENT=""
ENVIRONMENT=""
WEBHOOK=""
LIVE_URL=""
RESET_TOKEN=0
RESET_LIVE_KEY=0
REPO_RAW="https://raw.githubusercontent.com/pixtaha/pixtaha-server-manager"

APP_DIR="/opt/pixtaha-collector"
CONF_DIR="/etc/pixtaha-collector"
CONF="$CONF_DIR/config.env"
BIN="/usr/local/bin/pixtaha-collector"
UNIT_DIR="/etc/systemd/system"

die() { echo "error: $*" >&2; exit 1; }
say() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --client) CLIENT="$2"; shift 2 ;;
    --env) ENVIRONMENT="$2"; shift 2 ;;
    --webhook) WEBHOOK="$2"; shift 2 ;;
    --live-url) LIVE_URL="$2"; shift 2 ;;
    --reset-token) RESET_TOKEN=1; shift ;;
    --reset-live-key) RESET_LIVE_KEY=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root"
command -v systemctl >/dev/null || die "systemd is required"
command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' || die "python3 3.8 or newer is required"

# keep values from an existing install unless new ones are given
old() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | head -n 1 || true; }
[ -n "$CLIENT" ] || CLIENT="$(old PIXTAHA_CLIENT)"
[ -n "$ENVIRONMENT" ] || ENVIRONMENT="$(old PIXTAHA_ENV)"
[ -n "$WEBHOOK" ] || WEBHOOK="$(old PIXTAHA_WEBHOOK_URL)"
[ -n "$LIVE_URL" ] || LIVE_URL="$(old PIXTAHA_LIVE_URL)"
TOKEN="$(old PIXTAHA_REPORT_TOKEN)"
LIVE_KEY="$(old PIXTAHA_LIVE_KEY)"

ask() {
  local prompt="$1" var
  read -r -p "$prompt" var </dev/tty
  printf '%s' "$var"
}
[ -n "$CLIENT" ] || CLIENT="$(ask 'Client name: ')"
[ -n "$ENVIRONMENT" ] || ENVIRONMENT="$(ask 'Environment (production/demo/dev): ')"
[ -n "$WEBHOOK" ] || WEBHOOK="$(ask 'Webhook URL: ')"
case "$ENVIRONMENT" in production|demo|dev) ;; *) die "env must be production, demo or dev" ;; esac
case "$WEBHOOK" in https://*) ;; *) die "webhook URL must start with https://" ;; esac
[ -n "$CLIENT" ] || die "client name is required"

if [ -z "$TOKEN" ] || [ "$RESET_TOKEN" -eq 1 ]; then
  read -r -s -p "Report token: " TOKEN </dev/tty
  echo
fi
[ -n "$TOKEN" ] || die "report token is required"

if [ -n "$LIVE_URL" ]; then
  LIVE_URL="${LIVE_URL%/}"
  case "$LIVE_URL" in https://*) ;; *) die "live URL must start with https://" ;; esac
  if [ -z "$LIVE_KEY" ] || [ "$RESET_LIVE_KEY" -eq 1 ]; then
    read -r -s -p "Live key (Supabase anon key): " LIVE_KEY </dev/tty
    echo
  fi
  [ -n "$LIVE_KEY" ] || die "live key is required with --live-url"
fi

say "Downloading collector ($REF)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$REPO_RAW/$REF/collector/pixtaha_collector.py" -o "$TMP/pixtaha_collector.py"
curl -fsSL "$REPO_RAW/$REF/collector/uninstall.sh" -o "$TMP/uninstall.sh"
python3 -m py_compile "$TMP/pixtaha_collector.py" || die "downloaded collector does not compile"
install -d -m 755 "$APP_DIR"
install -m 755 "$TMP/pixtaha_collector.py" "$APP_DIR/pixtaha_collector.py"
install -m 755 "$TMP/uninstall.sh" "$APP_DIR/uninstall.sh"
ln -sf "$APP_DIR/pixtaha_collector.py" "$BIN"
printf '%s\n' "$REF" > "$APP_DIR/REF"

say "Writing config $CONF (mode 600)"
install -d -m 700 "$CONF_DIR"
umask 077
{
  echo "# Pixtaha Management collector. Keep this file private (mode 600)."
  echo "PIXTAHA_CLIENT=$CLIENT"
  echo "PIXTAHA_ENV=$ENVIRONMENT"
  echo "PIXTAHA_WEBHOOK_URL=$WEBHOOK"
  echo "PIXTAHA_REPORT_TOKEN=$TOKEN"
  if [ -n "$LIVE_URL" ]; then
    echo "PIXTAHA_LIVE_URL=$LIVE_URL"
    echo "PIXTAHA_LIVE_KEY=$LIVE_KEY"
  fi
  for k in PIXTAHA_PUBLIC_IP PIXTAHA_EXTRA_IPS PIXTAHA_BACKUP_DIRS PIXTAHA_BACKUP_IGNORE PIXTAHA_DASHBOARD_URL PIXTAHA_HOSTNAME PIXTAHA_ALERT_URL PIXTAHA_ALERT_DOMAINS PIXTAHA_LIVE_INTERVAL; do
    v="$(old "$k")"
    [ -n "$v" ] && echo "$k=$v"
  done
} > "$CONF.tmp"
chmod 600 "$CONF.tmp"
mv "$CONF.tmp" "$CONF"
unset TOKEN LIVE_KEY

say "Installing systemd timers"
REPORT_CAL="*-*-* 08:55:00 Africa/Cairo"
if ! systemd-analyze calendar "$REPORT_CAL" >/dev/null 2>&1; then
  REPORT_CAL="*-*-* 06:55:00 UTC"
  echo "    this systemd has no time zone support in timers, using $REPORT_CAL"
fi

common_service() {
  cat <<EOF
[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=read-only
StateDirectory=pixtaha-collector
StateDirectoryMode=0700
ReadWritePaths=/var/lib/pixtaha-collector
Environment=DOCKER_CONFIG=/var/lib/pixtaha-collector/docker
MemoryMax=256M
CPUQuota=50%
EOF
}

{
  echo "[Unit]"
  echo "Description=Pixtaha collector: 5-minute sample (read-only)"
  echo
  common_service
  echo "ExecStart=$BIN sample"
  echo "TimeoutStartSec=120"
} > "$UNIT_DIR/pixtaha-collector-sample.service"

cat > "$UNIT_DIR/pixtaha-collector-sample.timer" <<EOF
[Unit]
Description=Pixtaha collector: sample every 5 minutes

[Timer]
OnBootSec=2min
OnCalendar=*:0/5
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF

{
  echo "[Unit]"
  echo "Description=Pixtaha collector: daily report (read-only)"
  echo "Wants=network-online.target"
  echo "After=network-online.target"
  echo
  common_service
  echo "ExecStart=$BIN report"
  echo "TimeoutStartSec=1200"
} > "$UNIT_DIR/pixtaha-collector-report.service"

cat > "$UNIT_DIR/pixtaha-collector-report.timer" <<EOF
[Unit]
Description=Pixtaha collector: daily report

[Timer]
OnCalendar=$REPORT_CAL
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF

{
  echo "[Unit]"
  echo "Description=Pixtaha collector: refresh report for the live dashboard (read-only, no email)"
  echo "Wants=network-online.target"
  echo "After=network-online.target"
  echo
  common_service
  echo "ExecStart=$BIN report --refresh"
  echo "TimeoutStartSec=600"
} > "$UNIT_DIR/pixtaha-collector-refresh.service"

cat > "$UNIT_DIR/pixtaha-collector-refresh.timer" <<EOF
[Unit]
Description=Pixtaha collector: refresh report 5 minutes after the previous one

[Timer]
OnBootSec=3min
OnUnitInactiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF

cat > "$UNIT_DIR/pixtaha-collector-live.service" <<EOF
[Unit]
Description=Pixtaha collector: live snapshot every 5 seconds (read-only)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=$BIN live
Restart=on-failure
RestartSec=15
Nice=10
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=read-only
StateDirectory=pixtaha-collector
StateDirectoryMode=0700
ReadWritePaths=/var/lib/pixtaha-collector
Environment=DOCKER_CONFIG=/var/lib/pixtaha-collector/docker
MemoryMax=96M
CPUQuota=10%

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pixtaha-collector-sample.timer pixtaha-collector-report.timer pixtaha-collector-refresh.timer >/dev/null
systemctl enable pixtaha-collector-live.service >/dev/null
systemctl restart pixtaha-collector-live.service
systemctl start pixtaha-collector-sample.service

say "Installed"
"$BIN" status
echo
echo "Next report: $(systemctl show pixtaha-collector-report.timer -p NextElapseUSecRealtime --value)"
if [ -n "$LIVE_URL" ]; then
  echo "Live dashboard: on (every 5 s). Check with: pixtaha-collector status   (live push: ... ok)"
else
  echo "Live dashboard: off (run again with --live-url to turn it on)"
fi
echo "Send a test report now:  pixtaha-collector report --id-suffix test"
echo "Preview without sending: pixtaha-collector report --dry-run | less"
echo "Remove:                  bash $APP_DIR/uninstall.sh   (add --purge to delete config and state)"
