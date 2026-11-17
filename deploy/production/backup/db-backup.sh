#!/usr/bin/env bash
# Nightly CrewFlow360 database backup on the VPS (run by cron as root).
# Dumps the Supabase Postgres schemas that hold business data and logins
# (public, auth, storage metadata) in pg_dump custom format, verifies the
# archive, and keeps KEEP_DAYS days of copies. Uploaded files in Supabase
# Storage buckets are NOT included.
set -euo pipefail

backup_dir=/var/backups/crewflow360
url_file=/etc/crewflow360/backup-db-url
keep_days="${KEEP_DAYS:-14}"
image=postgres:17-alpine

umask 077
install -d -m 700 "$backup_dir"
[ -s "$url_file" ] || { echo "missing $url_file" >&2; exit 1; }

name="crewflow360-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker run --rm \
  -v "$url_file:/run/db-url:ro" \
  -v "$backup_dir:/backup" \
  "$image" \
  sh -c 'pg_dump --dbname="$(cat /run/db-url)" --format=custom --no-owner \
    --no-privileges --schema=public --schema=auth --schema=storage \
    --file="/backup/$1.partial" && pg_restore --list "/backup/$1.partial" >/dev/null' \
  sh "$name"

mv "$backup_dir/$name.partial" "$backup_dir/$name"
find "$backup_dir" -name 'crewflow360-*.dump' -mtime +"$keep_days" -delete
find "$backup_dir" -name '*.partial' -mmin +120 -delete

echo "$(date -u +%FT%TZ) ok $name $(du -h "$backup_dir/$name" | cut -f1)"
