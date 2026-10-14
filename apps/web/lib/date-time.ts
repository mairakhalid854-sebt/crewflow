const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateTimeParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly year: number;
}

function partsInTimeZone(date: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    month: value('month'),
    year: value('year'),
  };
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

export function businessDateString(date: Date, timeZone: string): string {
  const parts = partsInTimeZone(date, timeZone);
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}`;
}

export function addCalendarDays(value: string, amount: number): string | null {
  const match = calendarDatePattern.exec(value);
  if (!match || !Number.isInteger(amount)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

export function startOfCalendarWeek(value: string): string | null {
  const normalized = addCalendarDays(value, 0);
  if (!normalized) return null;
  const match = calendarDatePattern.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addCalendarDays(normalized, -dayOfWeek);
}

function sameParts(left: DateTimeParts, right: DateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

export function localDateTimeToIso(
  value: string,
  timeZone: string,
): string | null {
  const match = localDateTimePattern.exec(value);
  if (!match) return null;

  const desired: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const normalized = new Date(desiredAsUtc);
  if (
    normalized.getUTCFullYear() !== desired.year ||
    normalized.getUTCMonth() + 1 !== desired.month ||
    normalized.getUTCDate() !== desired.day ||
    normalized.getUTCHours() !== desired.hour ||
    normalized.getUTCMinutes() !== desired.minute
  ) {
    return null;
  }

  let instant = desiredAsUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const rendered = partsInTimeZone(new Date(instant), timeZone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
    );
    instant += desiredAsUtc - renderedAsUtc;
  }

  const result = new Date(instant);
  return sameParts(partsInTimeZone(result, timeZone), desired)
    ? result.toISOString()
    : null;
}

export function isoToLocalDateTime(
  value: string | null,
  timeZone: string,
): string {
  if (!value) return '';
  const parts = partsInTimeZone(new Date(value), timeZone);
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}
