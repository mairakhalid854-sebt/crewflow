#!/usr/bin/env bash
# One-time install of the nightly database backup. Run as root on the VPS.
# Prompts for the Supabase database password without echoing it.
# Re-enter the password later with: install-backup.sh --reset
set -euo pipefail

install -d -m 700 /etc/crewflow360 /opt/crewflow360-backup
install -m 700 "$(dirname "$0")/db-backup.sh" /opt/crewflow360-backup/db-backup.sh

if [ "${1:-}" = "--reset" ]; then
  rm -f /etc/crewflow360/backup-db-url
fi

if [ ! -s /etc/crewflow360/backup-db-url ]; then
  # Ask only for the database password (hidden) and build the Session pooler
  # URI here, so special characters are encoded correctly.
  read -r -s -p 'Database password (paste ONCE, then Enter; nothing will show): ' password
  echo
  [ -n "$password" ] || { echo 'No password entered.' >&2; exit 1; }
  encoded="$(PASSWORD="$password" python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["PASSWORD"], safe=""))')"
  unset password
  umask 077
  printf 'postgresql://postgres.mlgfyxsqorualqwbecmp:%s@aws-0-us-east-1.pooler.supabase.com:5432/postgres'     "$encoded" > /etc/crewflow360/backup-db-url
  unset encoded
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
