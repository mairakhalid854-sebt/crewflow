# Voice assistant (Alan AI)

Status: built on `growth-b1/voice-alan`, **not live**. The feature is off until
`NEXT_PUBLIC_ALAN_SDK_KEY` is set at build time.

## What it does

A microphone button appears in the bottom-right corner of the signed-in web
app. The user can speak, or type in the Alan chat, to move around CrewFlow360:

| Say                                                  | Result                                 |
| ---------------------------------------------------- | -------------------------------------- |
| "Open jobs", "Go to dispatch", "Show my invoices"    | Opens that page                        |
| "Create a new job", "Add a new customer"             | Opens the New job or New customer form |
| "Show scheduled jobs", "Show completed jobs"         | Jobs list filtered by status           |
| "Find job AC repair", "Search jobs for water heater" | Jobs list search                       |
| "Find customer John Smith"                           | Customers list search                  |
| "Go back"                                            | Previous page                          |
| "What can I say?"                                    | Spoken help                            |

## Safety

- The app, not Alan, decides every URL (`apps/web/lib/voice/voice-commands.ts`).
  A spoken command can only open a page the signed-in role can already open.
  For example, a technician cannot open Customers or Settings by voice.
- Only the screen name, role, and the list of allowed page names are sent to
  Alan as visual state. No customer names, addresses, prices, or other records
  are sent.
- Voice audio and spoken text are processed by Alan AI's servers. Tell clients
  this before they turn it on.
- The 9 MB Alan library is loaded only when the key is set, as a separate
  chunk, so the app stays fast when the feature is off.

## One-time setup in Alan AI Studio (owner)

1. Sign up at <https://studio.alan.app> with the CrewFlow360 business email.
2. Create a project named `CrewFlow360` (empty project).
3. Open the project's script editor, delete the sample, and paste the script
   below. Save it.
4. Test it in the Studio's debug chat: type `open jobs`. The log should show
   the command `{"command":"navigate","page":"jobs"}`.
5. Open **Integrations** and copy the **Alan SDK Key**. It is a public client
   key, so it is safe to share with the developer.

## Turning it on

- Local: put the key in `apps/web/.env.local` as `NEXT_PUBLIC_ALAN_SDK_KEY=...`.
- Production (only when the owner says go live): add the GitHub Actions
  variable `CREWFLOW_PRODUCTION_ALAN_SDK_KEY`, then deploy `main`. Remove the
  variable and deploy again to turn it off.

## Dialog script (paste into Alan AI Studio)

```js
// CrewFlow360 voice navigation. The web app checks every command against the
// signed-in role, so this script never needs to know about permissions.

const PAGE_WORDS = {
  overview: 'overview',
  dashboard: 'overview',
  home: 'overview',
  jobs: 'jobs',
  'job list': 'jobs',
  'work orders': 'jobs',
  invoices: 'invoices',
  billing: 'billing',
  dispatch: 'dispatch',
  'dispatch board': 'dispatch',
  schedule: 'dispatch',
  calendar: 'dispatch',
  customers: 'customers',
  clients: 'customers',
  services: 'services',
  'price list': 'services',
  'profit guard': 'profit',
  profit: 'profit',
  team: 'team',
  technicians: 'team',
  'audit trail': 'audit',
  audit: 'audit',
  intake: 'intake',
  requests: 'intake',
  'ai operations': 'ai',
  approvals: 'ai',
  'knowledge base': 'knowledge',
  profile: 'profile',
  'my profile': 'profile',
  settings: 'settings',
  'company settings': 'settings',
};

const PAGE_SLOT = Object.keys(PAGE_WORDS).join('|');

function allowed(p, page) {
  const pages = p.visual && p.visual.pages;
  return !Array.isArray(pages) || pages.includes(page);
}

function openPage(p, page, spoken) {
  if (!allowed(p, page)) {
    p.play('Sorry, your role cannot open that page.');
    return;
  }
  p.play({ command: 'navigate', page });
  p.play(`Opening ${spoken}.`);
}

intent(
  `(open|show|go to|take me to|navigate to) (the|my|) $(PAGE ${PAGE_SLOT}) (page|screen|)`,
  (p) => {
    const spoken = p.PAGE.value.toLowerCase();
    openPage(p, PAGE_WORDS[spoken], spoken);
  },
);

intent('(create|add|make|start) (a|an|) new job', (p) => {
  openPage(p, 'new-job', 'the new job form');
});

intent('(create|add) (a|an|) new (customer|client)', (p) => {
  openPage(p, 'new-customer', 'the new customer form');
});

intent(
  '(show|list|find) (me|) (all|) $(STATUS new|quoted|accepted|scheduled|in progress|completed|closed|cancelled) jobs',
  (p) => {
    const status = p.STATUS.value.toLowerCase().replace(' ', '_');
    p.play({ command: 'searchJobs', status });
    p.play(`Showing ${p.STATUS.value} jobs.`);
  },
);

intent(
  '(find|search|look up) (for|) (job|jobs) (for|about|) $(QUERY* .+)',
  (p) => {
    p.play({ command: 'searchJobs', query: p.QUERY.value });
    p.play(`Searching jobs for ${p.QUERY.value}.`);
  },
);

intent('(find|search|look up) (for|) (customer|client) $(QUERY* .+)', (p) => {
  if (!allowed(p, 'customers')) {
    p.play('Sorry, your role cannot open customers.');
    return;
  }
  p.play({ command: 'searchCustomers', query: p.QUERY.value });
  p.play(`Searching customers for ${p.QUERY.value}.`);
});

intent('(go|) back', 'previous page', (p) => {
  p.play({ command: 'goBack' });
});

intent('help', 'what can I (say|do|ask)', (p) => {
  p.play(
    'You can say: open jobs, go to dispatch, show scheduled jobs, ' +
      'find customer John Smith, create a new job, or go back.',
  );
});
```
