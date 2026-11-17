#!/usr/bin/env bash
# One-time install of the nightly database backup. Run as root on the VPS.
# Prompts for the Supabase connection string without echoing it.
set -euo pipefail

install -d -m 700 /etc/crewflow360 /opt/crewflow360-backup
install -m 700 "$(dirname "$0")/db-backup.sh" /opt/crewflow360-backup/db-backup.sh

if [ ! -s /etc/crewflow360/backup-db-url ]; then
  read -r -s -p 'Paste the Supabase Session pooler connection string, then Enter: ' url
  echo
  case "$url" in
    postgres://* | postgresql://*) ;;
    *) echo 'That does not look like a postgres connection string.' >&2; exit 1 ;;
  esac
  umask 077
  printf '%s' "$url" > /etc/crewflow360/backup-db-url
  unset url
fi
chmod 600 /etc/crewflow360/backup-db-url

cat > /etc/cron.d/crewflow360-db-backup <<'CRON'
# CrewFlow360 nightly database backup (03:17 UTC = 08:17 PKT)
17 3 * * * root /opt/crewflow360-backup/db-backup.sh >> /var/log/crewflow360-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/crewflow360-db-backup

cat > /etc/logrotate.d/crewflow360-backup <<'ROT'
/var/log/crewflow360-backup.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
ROT

echo 'Running the first backup now...'
/opt/crewflow360-backup/db-backup.sh | tee -a /var/log/crewflow360-backup.log
echo 'CrewFlow360 backup installed.'
