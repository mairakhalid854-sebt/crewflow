// Voice form filling. Turns "first name Hassaan", "first name put Hassaan" or
// "set email to john at gmail dot com" into "put this value in that field" on
// the page that is open. Saving is a separate "save" command.

export type FillCommand =
  | { readonly kind: 'fill'; readonly field: string; readonly value: string }
  | { readonly kind: 'clear'; readonly field: string }
  | {
      readonly kind: 'check';
      readonly field: string;
      readonly checked: boolean;
    }
  | { readonly kind: 'focus'; readonly field: string };

const FILL_VERB =
  /^(?:please )?(?:add|set|put|enter|type|write|fill(?: in)?|change|update|make|use|insert)(?: the| a| an| my)? (.+?) (?:as|to|is|equals|with|=|:)\s*(.+)$/i;
const FIELD_IS_VALUE =
  /^(?:the |my )?(.+?)\s*(?: is | as | equals | equal to | put | should be | will be | set to | to be |:|=)\s*(.+)$/i;
const FOCUS =
  /^(?:please )?(?:go to|move to|jump to|focus(?: on)?)(?: the)? (.+?)$/i;
const CLEAR = /^(?:please )?(?:clear|empty|erase)(?: the)? (.+?)$/i;
const CHECK =
  /^(?:please )?(check|tick|select|enable|turn on|uncheck|untick|unselect|deselect|disable|turn off)(?: the)? (.+?)$/i;

function tidy(text: string): string {
  return text
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function tidyField(text: string): string {
  return tidy(text)
    .toLowerCase()
    .replace(/\s+(?:field|box|input)$/, '')
    .trim();
}

// Explicit "<verb> <field> as <value>" and "<field> is <value>" forms. A
// command with no separator ("first name Hassaan") is handled by
// matchLeadingField, which needs the field labels on the page.
export function parseFillCommand(input: string): FillCommand | undefined {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 300) return undefined;

  const clear = text.match(CLEAR);
  if (clear?.[1]) return { field: tidyField(clear[1]), kind: 'clear' };

  const check = text.match(CHECK);
  if (check?.[1] && check[2]) {
    const off = /^(un|de|disable|turn off)/i.test(check[1]);
    return { checked: !off, field: tidyField(check[2]), kind: 'check' };
  }

  const match = text.match(FILL_VERB) ?? text.match(FIELD_IS_VALUE);
  if (match?.[1] && match[2]) {
    const field = tidyField(match[1]);
    const value = tidy(match[2]);
    if (field && value && field.split(' ').length <= 5) {
      return { field, kind: 'fill', value };
    }
  }

  const focus = text.match(FOCUS);
  if (focus?.[1]) return { field: tidyField(focus[1]), kind: 'focus' };
  return undefined;
}

// Strict match for "go to <field>": only a label that is, or starts with,
// what was said, so "go to customers" still opens the Customers page.
export function matchFieldStrict(
  spoken: string,
  labels: readonly string[],
): number | undefined {
  const target = normalizeLabel(spoken);
  if (!target) return undefined;
  const normalized = labels.map(normalizeLabel);
  const exact = normalized.indexOf(target);
  if (exact >= 0) return exact;
  const starts = normalized.findIndex((label) =>
    label.startsWith(`${target} `),
  );
  return starts >= 0 ? starts : undefined;
}

export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[*:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SYNONYMS: ReadonlyArray<readonly [string, string]> = [
  ['zip', 'zip code'],
  ['postal code', 'zip code'],
  ['postcode', 'zip code'],
  ['phone number', 'phone'],
  ['mobile', 'phone'],
  ['cell', 'phone'],
  ['email address', 'email'],
  ['e-mail', 'email'],
  ['mail', 'email'],
  ['address', 'street address'],
  ['street', 'street address'],
  ['notes', 'internal notes'],
  ['note', 'notes'],
  ['surname', 'last name'],
  ['family name', 'last name'],
  ['given name', 'first name'],
  ['name', 'first name'],
];

function wordsIn(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

// Picks the page field whose label best matches what was said. Returns the
// index into labels, or undefined when nothing is a confident match.
export function matchField(
  spoken: string,
  labels: readonly string[],
): number | undefined {
  const target = normalizeLabel(spoken);
  if (!target) return undefined;
  const normalized = labels.map(normalizeLabel);
  const tries = [
    target,
    ...SYNONYMS.filter(([from]) => from === target).map(([, to]) => to),
  ];

  for (const candidate of tries) {
    const exact = normalized.indexOf(candidate);
    if (exact >= 0) return exact;
  }
  for (const candidate of tries) {
    const starts = normalized.findIndex((label) =>
      label.startsWith(`${candidate} `),
    );
    if (starts >= 0) return starts;
  }
  for (const candidate of tries) {
    const contains = normalized.findIndex((label) => wordsIn(label, candidate));
    if (contains >= 0) return contains;
  }
  // "phone number" said for a field labelled "Phone".
  const spokenContains = normalized.findIndex(
    (label) => label.length >= 3 && wordsIn(target, label),
  );
  return spokenContains >= 0 ? spokenContains : undefined;
}

// "first name Hassaan" (no "as"/"is"): the longest field label at the start of
// the sentence is the field; the rest is the value.
export function matchLeadingField(
  input: string,
  labels: readonly string[],
): { readonly index: number; readonly value: string } | undefined {
  const text = input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(
      /^(?:please )?(?:add|set|put|enter|type|write|fill(?: in)?|insert|go to|move to|jump to)(?: the| a| an| my)? /i,
      '',
    );
  const lower = text.toLowerCase();
  const normalized = labels.map(normalizeLabel);
  const options = [
    ...normalized.map((label, index) => [label, index] as const),
    ...SYNONYMS.flatMap(([from, to]) => {
      const index = normalized.indexOf(to);
      return index >= 0 ? [[from, index] as const] : [];
    }),
  ]
    .filter(([label]) => label.length >= 3)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [label, index] of options) {
    if (lower.startsWith(`${label} `)) {
      const value = tidy(text.slice(label.length));
      if (value) return { index, value };
    }
  }
  return undefined;
}

// Spoken email and phone values come out as words; turn them into text the
// field accepts.
export function normalizeSpokenValue(value: string, inputType: string): string {
  if (inputType === 'email') {
    return value
      .toLowerCase()
      .replace(/\s+at\s+/g, '@')
      .replace(/\s+dot\s+/g, '.')
      .replace(/\s+(?:underscore)\s+/g, '_')
      .replace(/\s+(?:dash|hyphen)\s+/g, '-')
      .replace(/\s+/g, '');
  }
  if (inputType === 'tel') {
    return value.replace(/[^\d+]/g, '');
  }
  if (inputType === 'number') {
    return value.replace(/[^\d.-]/g, '');
  }
  return value;
}
