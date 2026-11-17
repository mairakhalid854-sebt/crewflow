# Restoring a CrewFlow360 database backup

Backups live on the VPS in `/var/backups/crewflow360/` (14 days, nightly at
03:17 UTC). Log: `/var/log/crewflow360-backup.log`.

Restore into a **new or empty** Supabase project first and check it before
touching production:

```sh
docker run --rm -it -v /var/backups/crewflow360:/backup postgres:17-alpine \
  pg_restore --dbname='<target connection string>' --no-owner --no-privileges \
  --clean --if-exists /backup/crewflow360-<timestamp>.dump
```

Uploaded files in Supabase Storage buckets are not part of these backups.
