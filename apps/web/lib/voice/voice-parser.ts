// Turns what the user said (or typed) into a voice command object. Runs in the
// browser with no external service. The result is then checked against the
// user's role by resolveVoiceCommand().

import type { VoicePageName } from './voice-commands';

export type ParsedVoiceCommand =
  | { readonly command: 'navigate'; readonly page: VoicePageName }
  | {
      readonly command: 'searchJobs';
      readonly query?: string;
      readonly status?: string;
    }
  | { readonly command: 'searchCustomers'; readonly query: string }
  | { readonly command: 'goBack' }
  | { readonly command: 'help' };

// Longest phrases first so "new job" wins over "jobs".
const PAGE_WORD_LIST: ReadonlyArray<readonly [string, VoicePageName]> = [
  ['new job', 'new-job'],
  ['create job', 'new-job'],
  ['add job', 'new-job'],
  ['new customer', 'new-customer'],
  ['new client', 'new-customer'],
  ['add customer', 'new-customer'],
  ['add client', 'new-customer'],
  ['create customer', 'new-customer'],
  ['overview', 'overview'],
  ['dashboard', 'overview'],
  ['home', 'overview'],
  ['jobs', 'jobs'],
  ['job list', 'jobs'],
  ['work orders', 'jobs'],
  ['invoices', 'invoices'],
  ['invoice', 'invoices'],
  ['dispatch board', 'dispatch'],
  ['dispatch', 'dispatch'],
  ['schedule', 'dispatch'],
  ['calendar', 'dispatch'],
  ['customers', 'customers'],
  ['customer list', 'customers'],
  ['clients', 'customers'],
  ['services', 'services'],
  ['price list', 'services'],
  ['profit guard', 'profit'],
  ['profit', 'profit'],
  ['team', 'team'],
  ['technicians', 'team'],
  ['staff', 'team'],
  ['audit trail', 'audit'],
  ['audit log', 'audit'],
  ['audit', 'audit'],
  ['intake', 'intake'],
  ['requests', 'intake'],
  ['ai operations', 'ai'],
  ['approvals', 'ai'],
  ['knowledge base', 'knowledge'],
  ['knowledge', 'knowledge'],
  ['my profile', 'profile'],
  ['profile', 'profile'],
  ['company settings', 'settings'],
  ['settings', 'settings'],
  ['subscription', 'billing'],
  ['billing', 'billing'],
];

const PAGE_WORDS = [...PAGE_WORD_LIST].sort(
  (a, b) => b[0].length - a[0].length,
);

const STATUS_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['in progress', 'in_progress'],
  ['in-progress', 'in_progress'],
  ['new', 'new'],
  ['quoted', 'quoted'],
  ['accepted', 'accepted'],
  ['scheduled', 'scheduled'],
  ['completed', 'completed'],
  ['finished', 'completed'],
  ['closed', 'closed'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanQuery(value: string | undefined): string | undefined {
  const query = value
    ?.replace(/^(for|about|named|called|the)\s+/, '')
    .replace(/\s+(please|now)$/, '')
    .trim();
  return query && query.length <= 80 ? query : undefined;
}

export function parseVoiceText(input: string): ParsedVoiceCommand | undefined {
  const text = normalize(input);
  if (!text || text.length > 200) return undefined;

  if (/^(help|what can i (say|do|ask))\b/.test(text))
    return { command: 'help' };
  if (/^(go )?back$|^previous page$/.test(text)) return { command: 'goBack' };

  const customerSearch = text.match(
    /^(?:find|search|look up|lookup|show)(?: for)? (?:customer|client)s? (.+)$/,
  );
  if (customerSearch) {
    const query = cleanQuery(customerSearch[1]);
    if (query) return { command: 'searchCustomers', query };
  }

  const statusJobs = text.match(
    /^(?:show|list|find|open)(?: me)?(?: all)?(?: the)? (.+?) jobs$/,
  );
  if (statusJobs?.[1]) {
    const status = STATUS_WORDS.find(([word]) => word === statusJobs[1]);
    if (status) return { command: 'searchJobs', status: status[1] };
  }

  const jobSearch = text.match(
    /^(?:find|search|look up|lookup)(?: for)? (?:job|jobs) (.+)$/,
  );
  if (jobSearch) {
    const query = cleanQuery(jobSearch[1]);
    if (query) return { command: 'searchJobs', query };
  }

  const verb =
    /^(?:please )?(?:open|show|go to|goto|take me to|navigate to|bring up|view|create|add|make|start)(?: me)?(?: the| my| a| an)? /;
  const target = verb.test(text) ? text.replace(verb, '') : text;
  const page = PAGE_WORDS.find(
    ([words]) =>
      target === words ||
      target === `${words} page` ||
      target === `${words} screen`,
  );
  if (page) return { command: 'navigate', page: page[1] };

  return undefined;
}

export const voiceHelpText =
  'You can say: open jobs, go to dispatch, show scheduled jobs, find customer John Smith, create a new job, or go back.';
