import type { Json } from '@crewflow/database';

export interface ProposedChangeLine {
  readonly path: string;
  readonly value: string;
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' › ');
}

function scalar(value: Json): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return 'Unsupported value';
}

const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  assignedMembershipId: 'Technician',
  dueAt: 'Due date',
  paymentUrl: 'Payment link',
  taxRateBps: 'Tax rate',
};

/** "unitPriceCents" -> "Unit price", "scheduledStartAt" -> "Scheduled start". */
export function fieldLabel(key: string): string {
  const override = LABEL_OVERRIDES[key];
  if (override) return override;
  const words = key
    .replace(/(Cents|Bps|At|Id)$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

const usd = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
});

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readableValue(key: string, value: Json, timeZone: string): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key.endsWith('Cents')) return usd.format(value / 100);
    if (key.endsWith('Bps')) return `${value / 100}%`;
    return String(value);
  }
  if (typeof value === 'string') {
    if (key.endsWith('At') && !Number.isNaN(Date.parse(value))) {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(new Date(value));
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    return value
      .map((item) => {
        if (!isRecord(item)) return readableValue(key, item, timeZone);
        const description =
          typeof item.description === 'string' ? item.description : 'Item';
        const quantity =
          typeof item.quantity === 'number' ? item.quantity : undefined;
        const price =
          typeof item.unitPriceCents === 'number'
            ? usd.format(item.unitPriceCents / 100)
            : undefined;
        const parts = [description];
        if (quantity !== undefined && price)
          parts.push(`${quantity} × ${price}`);
        if (item.taxable === true) parts.push('taxable');
        return parts.join(' · ');
      })
      .join('; ');
  }
  return 'See the audit trace';
}

/**
 * Owner-readable version of an approval's proposed changes. Approvals store
 * `{ field: { from, to } }`; this turns that into "Total: $151.98" lines with
 * money, percentages, and dates formatted, instead of raw cents, basis points,
 * and ISO timestamps. Falls back to the generic flattened view for any other
 * shape.
 */
export function readableChangeLines(
  value: Json,
  timeZone: string,
): ProposedChangeLine[] {
  if (!isRecord(value)) return genericLines(value);
  const entries = Object.entries(value).filter(
    (entry): entry is [string, Json] => entry[1] !== undefined,
  );
  const isDiff =
    entries.length > 0 &&
    entries.every(([, change]) => isRecord(change) && 'to' in change);
  if (!isDiff) return genericLines(value);

  return entries.map(([key, change]) => {
    const { from = null, to = null } = change as {
      from?: Json;
      to?: Json;
    };
    const next = readableValue(key, to, timeZone);
    const previous = readableValue(key, from, timeZone);
    return {
      path: fieldLabel(key),
      value: from === null ? next : `${next} (was ${previous})`,
    };
  });
}

function genericLines(value: Json): ProposedChangeLine[] {
  return proposedChangeLines(value).map((line) => ({
    path: humanize(line.path),
    value: line.value,
  }));
}

export function proposedChangeLines(
  value: Json,
  maxLines = 50,
): ProposedChangeLine[] {
  const lines: ProposedChangeLine[] = [];

  function visit(current: Json, path: string): void {
    if (lines.length >= maxLines) return;
    if (Array.isArray(current)) {
      if (!current.length) lines.push({ path, value: 'Empty list' });
      current.forEach((item, index) => visit(item, `${path}[${index + 1}]`));
      return;
    }
    if (current !== null && typeof current === 'object') {
      const entries = Object.entries(current);
      if (!entries.length) lines.push({ path, value: 'No changes' });
      entries.forEach(([key, item]) => {
        if (item !== undefined) visit(item, path ? `${path}.${key}` : key);
      });
      return;
    }
    lines.push({ path: path || 'value', value: scalar(current) });
  }

  visit(value, '');
  if (lines.length === maxLines) {
    lines[maxLines - 1] = {
      path: 'More changes',
      value: 'Open the audit trace for the complete bounded payload.',
    };
  }
  return lines;
}
