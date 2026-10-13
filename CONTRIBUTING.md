# CrewFlow development workflow

CrewFlow uses short-lived branches, Conventional Commits, and a protected
staging-to-production path. Do not develop features directly on `staging` or
`main`.

## Branch roles

- `main`: production-ready code only. Promote to it through a reviewed release
  pull request from `staging`.
- `staging`: integration branch and Vercel Preview source. Merge completed work
  through a pull request after all checks pass.
- `feat/<short-name>`: new product behavior, for example
  `feat/company-settings`.
- `fix/<short-name>`: bug fixes, for example `fix/customer-search`.
- `chore/<short-name>`: tooling, CI, dependencies, and documentation changes.

## Required flow

1. Update local `staging` with `git pull --ff-only`.
2. Create a focused branch from `staging`.
3. Implement one coherent change and include its tests and documentation.
4. Run `npm run check`. For schema changes, also run the relevant Supabase
   migration checks and `supabase db lint`.
5. Push the branch and open a pull request into `staging`.
6. Merge only after CI is green and the diff has been reviewed.
7. Verify the Vercel staging deployment before starting dependent work.
8. Delete the short-lived branch after merge.

Database migrations are forward-only after they reach shared staging. Fix a
deployed migration with a new migration rather than rewriting its history.

## Commit messages

Use a meaningful Conventional Commit message:

```text
<type>(optional-scope): <imperative summary>
```

Accepted types include `feat`, `fix`, `docs`, `test`, `refactor`, `perf`,
`build`, `ci`, and `chore`.

Good examples:

```text
feat(settings): add weekly business hours editor
fix(customers): preserve city when editing an address
test(database): cover owner-only settings updates
docs: define staging release workflow
```

Avoid vague messages such as `update`, `changes`, `work`, or `fix stuff`.

## Production promotion

Production deployment is deliberate: open a pull request from `staging` to
`main`, confirm migrations and environment variables, run the complete quality
gate, review the staging smoke test, then merge. Never use a feature branch as a
production deployment source.
