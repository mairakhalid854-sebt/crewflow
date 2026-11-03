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
