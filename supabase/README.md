# Supabase development

This directory is the source of truth for CrewFlow's Supabase configuration and ordered SQL migrations. Do not make untracked production schema changes in the Supabase Dashboard.

## Local workflow

1. Install Docker Desktop and allocate at least 7 GB RAM.
2. Run `npm run supabase:start`.
3. Run `npm run supabase:reset` to rebuild from migrations.
4. Open local Studio at `http://127.0.0.1:54323` and Mailpit at `http://127.0.0.1:54324`.
5. Copy the local API URL and publishable key printed by the CLI into `.env.local`.

The local stack is development-only and must never be exposed publicly.

## Remote workflow

Create separate development, staging, and production Supabase projects. Linking and pushing are explicit operator actions; never run `db reset --linked` against production. Preview migrations with `supabase db push --dry-run` before applying them.
