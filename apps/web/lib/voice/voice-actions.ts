// Voice commands that press something on the open page: save the form, click a
// named button or link, edit, or delete/archive. Destructive presses always go
// through a confirmation first (see isDestructive).

export type PageActionCommand =
  | { readonly kind: 'save' }
  | { readonly kind: 'click'; readonly target: string }
  | { readonly kind: 'edit'; readonly target: string }
  | { readonly kind: 'delete'; readonly verb: string; readonly target: string };

export type ConfirmReply = 'yes' | 'no';

const SAVE =
  /^(?:please )?(?:save|submit|save and continue|done|finish|create it|update it|add it|save (?:it|this|that|the form|form|changes|the changes|now|customer|job|service|invoice|quote|report|settings|profile|details|record))$/;
const CLICK =
  /^(?:please )?(?:click|press|tap|hit|push|select|choose)(?: on)?(?: the)? (.+?)(?: button| link| tab)?$/;
const EDIT = /^(?:please )?(?:edit|modify)(?: this| the| that)?(?: (.+))?$/;
const DELETE =
  /^(?:please )?(delete|remove|archive|deactivate|void|trash|discard)(?: this| the| that| current)?(?: (.+))?$/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePageAction(input: string): PageActionCommand | undefined {
  const text = normalize(input);
  if (!text || text.length > 200) return undefined;
  if (SAVE.test(text)) return { kind: 'save' };
  const del = text.match(DELETE);
  if (del?.[1]) return { kind: 'delete', target: del[2] ?? '', verb: del[1] };
  const edit = text.match(EDIT);
  if (edit) return { kind: 'edit', target: edit[1] ?? '' };
  const click = text.match(CLICK);
  if (click?.[1]) return { kind: 'click', target: click[1] };
  return undefined;
}

export function parseConfirmReply(input: string): ConfirmReply | undefined {
  const text = normalize(input);
  if (
    /^(?:yes|yeah|yep|yup|confirm|confirmed|ok|okay|sure|do it|go ahead|proceed|haan|han|ha|ji|ji haan)(?: please| confirm| do it| delete it| archive it)?$/.test(
      text,
    )
  ) {
    return 'yes';
  }
  if (
    /^(?:no|nope|nah|cancel|stop|don't|do not|never mind|nevermind|nahi|nahin|na)(?: thanks| please)?$/.test(
      text,
    )
  ) {
    return 'no';
  }
  return undefined;
}

// Presses that remove data, or reach a customer or money, are confirmed first.
const NEEDS_CONFIRMATION =
  /\b(delete|remove|archive|deactivate|void|trash|discard|revoke|cancel job|cancel invoice|cancel quote|unpublish|disconnect|send|email|publish|approve|charge|refund|pay|invite)\b/i;

export function needsConfirmation(text: string): boolean {
  return NEEDS_CONFIRMATION.test(text);
}

// Chooses the clickable element whose visible text best matches what was
// said. Returns its index, or undefined when no match is confident.
export function matchControl(
  spoken: string,
  texts: readonly string[],
): number | undefined {
  const target = normalize(spoken);
  if (!target) return undefined;
  const normalized = texts.map(normalize);
  const exact = normalized.indexOf(target);
  if (exact >= 0) return exact;
  const starts = normalized.findIndex((text) => text.startsWith(target));
  if (starts >= 0) return starts;
  const contains = normalized.findIndex((text) =>
    ` ${text} `.includes(` ${target} `),
  );
  if (contains >= 0) return contains;
  const words = target.split(' ').filter((word) => word.length > 2);
  if (words.length === 0) return undefined;
  let best: number | undefined;
  let bestScore = 0;
  normalized.forEach((text, index) => {
    const score = words.filter((word) =>
      ` ${text} `.includes(` ${word}`),
    ).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return bestScore >= Math.ceil(words.length / 2) ? best : undefined;
}

// For "delete" / "archive this customer": the destructive control whose text
// uses the same verb, preferring one that also names what was said.
export function matchDestructiveControl(
  verb: string,
  target: string,
  texts: readonly string[],
): number | undefined {
  const normalized = texts.map(normalize);
  const verbs =
    verb === 'delete' || verb === 'remove' || verb === 'trash'
      ? ['delete', 'remove', 'archive', 'trash', 'deactivate']
      : [verb];
  const candidates = normalized
    .map((text, index) => ({ index, text }))
    .filter(({ text }) => verbs.some((word) => text.includes(word)));
  if (candidates.length === 0) return undefined;
  const words = normalize(target)
    .split(' ')
    .filter((word) => word.length > 2);
  const named = candidates.find(({ text }) =>
    words.some((word) => text.includes(word)),
  );
  return (named ?? candidates[0])?.index;
}
