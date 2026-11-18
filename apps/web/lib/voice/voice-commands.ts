// Turns a command sent by the Alan AI dialog script into a safe in-app action.
// The script only names a page or a search; the app decides the URL and checks
// the signed-in role, so a spoken command can never open a page the user's
// role cannot see.

export type VoiceRole = 'owner' | 'office' | 'technician';

export type VoiceAction =
  | { readonly kind: 'navigate'; readonly href: string; readonly label: string }
  | { readonly kind: 'back' };

type VoicePage = {
  readonly href: string;
  readonly label: string;
  readonly roles: readonly VoiceRole[];
};

const officeRoles: readonly VoiceRole[] = ['owner', 'office'];
const everyone: readonly VoiceRole[] = ['owner', 'office', 'technician'];

export const voicePages = {
  overview: { href: '/app', label: 'Overview', roles: everyone },
  jobs: { href: '/app/jobs', label: 'Jobs', roles: everyone },
  'new-job': { href: '/app/jobs/new', label: 'New job', roles: officeRoles },
  invoices: { href: '/app/invoices', label: 'Invoices', roles: officeRoles },
  dispatch: { href: '/app/dispatch', label: 'Dispatch', roles: officeRoles },
  customers: { href: '/app/customers', label: 'Customers', roles: officeRoles },
  'new-customer': {
    href: '/app/customers/new',
    label: 'New customer',
    roles: officeRoles,
  },
  services: { href: '/app/services', label: 'Services', roles: everyone },
  profit: { href: '/app/profit', label: 'Profit Guard', roles: ['owner'] },
  team: { href: '/app/team', label: 'Team', roles: officeRoles },
  audit: { href: '/app/audit', label: 'Audit trail', roles: officeRoles },
  intake: { href: '/app/intake', label: 'Intake', roles: officeRoles },
  ai: { href: '/app/ai', label: 'AI operations', roles: officeRoles },
  knowledge: {
    href: '/app/knowledge',
    label: 'Knowledge base',
    roles: officeRoles,
  },
  profile: { href: '/app/profile', label: 'My profile', roles: everyone },
  settings: { href: '/app/settings', label: 'Settings', roles: ['owner'] },
  billing: {
    href: '/app/billing',
    label: 'CrewFlow360 billing',
    roles: ['owner'],
  },
} as const satisfies Record<string, VoicePage>;

export type VoicePageName = keyof typeof voicePages;

const jobStatuses = new Set([
  'new',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
]);

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function pageFor(name: unknown, role: VoiceRole): VoicePage | undefined {
  if (typeof name !== 'string' || !Object.hasOwn(voicePages, name)) {
    return undefined;
  }
  const page: VoicePage = voicePages[name as VoicePageName];
  return page.roles.includes(role) ? page : undefined;
}

export function resolveVoiceCommand(
  data: unknown,
  role: VoiceRole,
): VoiceAction | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const command = (data as Record<string, unknown>)['command'];
  const payload = data as Record<string, unknown>;

  if (command === 'goBack') return { kind: 'back' };

  if (command === 'navigate') {
    const page = pageFor(payload['page'], role);
    return page
      ? { kind: 'navigate', href: page.href, label: page.label }
      : undefined;
  }

  if (command === 'searchJobs') {
    if (!pageFor('jobs', role)) return undefined;
    const params = new URLSearchParams();
    const query = text(payload['query'], 80);
    const status = text(payload['status'], 20)?.toLowerCase();
    if (query) params.set('q', query);
    if (status && jobStatuses.has(status)) params.set('status', status);
    const search = params.toString();
    return {
      kind: 'navigate',
      href: search ? `/app/jobs?${search}` : '/app/jobs',
      label: 'Jobs',
    };
  }

  if (command === 'searchCustomers') {
    if (!pageFor('customers', role)) return undefined;
    const query = text(payload['query'], 80);
    return {
      kind: 'navigate',
      href: query
        ? `/app/customers?${new URLSearchParams({ q: query }).toString()}`
        : '/app/customers',
      label: 'Customers',
    };
  }

  return undefined;
}

// What the dialog script may know about the current screen. Never include
// customer names, addresses, prices, or other business records here: this is
// sent to Alan AI's servers.
export function voiceVisualState(pathname: string, role: VoiceRole) {
  const pages = Object.entries(voicePages)
    .filter(([, page]) => (page.roles as readonly VoiceRole[]).includes(role))
    .map(([name]) => name);
  const current = Object.entries(voicePages)
    .filter(([, page]) => page.href === pathname)
    .map(([name]) => name)[0];
  return { screen: current ?? 'other', role, pages };
}
