# Mobile release readiness

Updated: 2026-10-19

CrewFlow now has native release assets, Expo development-client support, an
owner-controlled EAS project, EAS build profiles, an application-public
privacy-notice route, and draft store metadata. Store publication remains
blocked until the required external accounts and privacy/legal details are
approved.

## Build profiles

Run EAS commands from `apps/mobile`.

| Profile                 | Purpose                                 | Output                                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------ |
| `development`           | Physical Android/iOS development client | Internally distributed development build         |
| `development-simulator` | iOS simulator development client        | Simulator `.app`                                 |
| `preview`               | Production-like Android/device testing  | Installable Android `.apk` or internal iOS build |
| `preview-simulator`     | Production-like iOS simulator testing   | Simulator `.app`                                 |
| `production`            | Store submission candidate              | Android `.aab` / iOS store archive               |

Linked project:

- EAS owner: `mairakhalids-crewflow`
- EAS project: `@mairakhalids-crewflow/crewflow`
- Dashboard: `https://expo.dev/accounts/mairakhalids-crewflow/projects/crewflow`
- The public EAS project ID is committed under `expo.extra.eas.projectId` and
  push registration reads that value automatically.

Required setup for cloud builds:

1. Configure these EAS environment variables for the intended environment:
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   and `EXPO_PUBLIC_WEB_APP_URL`. `EXPO_PUBLIC_EAS_PROJECT_ID` remains an
   optional local override only.
2. Configure FCM v1 and Apple push credentials in the owner-controlled Expo,
   Google, and Apple accounts.
3. Create an Android test build with
   `npx eas-cli@latest build --platform android --profile development`.
4. For an iOS simulator build, run
   `npx eas-cli@latest build --platform ios --profile development-simulator`.

After a development build is installed, start Metro with
`npm run start --workspace @crewflow/mobile -- --dev-client --tunnel`. Splash
screens must be verified with a preview or production build because the
development client has its own launch UI.

## Verified cloud test builds

The first owner-controlled EAS test-build pair completed successfully on
2026-10-19. The persistent build pages remain the source of truth; internal
artifact downloads expire automatically.

| Platform                | Profile                 | Build ID                                                                                                                                                | Result                                                           |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Android physical device | `development`           | [`283ea812-38a8-4a98-8866-d660cc02356f`](https://expo.dev/accounts/mairakhalids-crewflow/projects/crewflow/builds/283ea812-38a8-4a98-8866-d660cc02356f) | Development APK generated; artifact endpoint verified `200 OK`   |
| iOS simulator           | `development-simulator` | [`63a6084c-18cd-4a5c-bb76-a62cdc759b18`](https://expo.dev/accounts/mairakhalids-crewflow/projects/crewflow/builds/63a6084c-18cd-4a5c-bb76-a62cdc759b18) | Simulator archive generated; artifact endpoint verified `200 OK` |

Installed-device and simulator feature verification remains part of the
combined Phase 4 acceptance checklist. A physical-iPhone internal build still
requires an owner-controlled Apple Developer account and signing credentials.

## Draft store listing

- App name: `CrewFlow`
- Subtitle: `Field service, in flow`
- Primary category: `Business`
- Secondary category: `Productivity`
- Android short description: `Run jobs, schedules, field updates, and approvals from one secure workspace.`
- Promotional text: `Give owners, office teams, and technicians a clearer view of every job.`
- Privacy URL candidate (currently protected by Vercel Deployment Protection):
  `https://crewflow-git-staging-saas-team-crew-flow.vercel.app/privacy`
- Support URL: blocked until a final public domain and support channel exist.
- Marketing URL: blocked until the public marketing site and final domain exist.

### Full description draft

CrewFlow gives home-service businesses one workspace for the work happening in
the office and in the field. Owners and office teams can review schedules,
assign technicians, track active jobs, and approve customer documents.
Technicians can see assigned work, record progress, add private job photos,
capture customer completion signatures, and receive operational alerts.

CrewFlow keeps each business workspace isolated, limits actions by role, and
records important changes in an audit trail. Sensitive customer documents stay
reviewable by a human before they are published. Offline recovery protects
pending photos and progress-note drafts without silently submitting job status
changes.

Some capabilities require an invitation from a participating service business.
CrewFlow does not process customer service payments.

### Search keywords draft

`field service,dispatch,jobs,scheduling,technician,work order,crew,service business`

## Privacy-label and data-safety draft

The final Apple privacy labels and Google Play Data safety form must match the
shipping binary and be reviewed by the owner and counsel.

| Data category            | Examples                                         | Purpose                                  |
| ------------------------ | ------------------------------------------------ | ---------------------------------------- |
| Contact and account data | Name, work email, role                           | Authentication and account management    |
| Customer and job data    | Phone, email, address, schedule, service details | Core app functionality                   |
| User content             | Job notes, photos, signatures                    | Field execution and business records     |
| Device identifiers       | Installation ID, Expo push token                 | Notifications, security, token rotation  |
| Operational records      | Audit events, status history, security logs      | Security, support, and app functionality |

CrewFlow does not currently include an advertising SDK or cross-app tracking.
Re-check the dependency inventory before every store submission.

## Store assets and external blockers

Generated project assets live in `apps/mobile/assets`:

- 1024px app icon
- Android adaptive foreground and monochrome layers
- 96px Android notification icon
- transparent splash mark
- web favicon

External work still required:

- final brand/domain clearance;
- a monitored public support email or support form;
- legal entity/controller contact details and counsel-approved privacy notice;
- owner-controlled Apple Developer and Google Play Console accounts;
- FCM/APNs credentials for the linked owner-controlled Expo project;
- final device screenshots and store-review notes;
- physical-device and simulator verification from the combined Phase 4 test
  checklist.
