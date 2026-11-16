const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface QuietHoursWindow {
  startMinutes: number;
  endMinutes: number;
}

export const FALLBACK_TIMEZONE = 'Asia/Jakarta';

/** Parses `HH:mm` quiet-hour boundaries. Returns null when disabled or malformed. */
export function parseQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
): QuietHoursWindow | null {
  if (typeof start !== 'string' || typeof end !== 'string') {
    return null;
  }

  const startValue = start.trim();
  const endValue = end.trim();

  if (!TIME_PATTERN.test(startValue) || !TIME_PATTERN.test(endValue)) {
    return null;
  }

  const startMinutes = toMinutes(startValue);
  const endMinutes = toMinutes(endValue);

  // start === end is a nonsensical window; treat it as "quiet hours disabled".
  if (startMinutes === endMinutes) {
    return null;
  }

  return { startMinutes, endMinutes };
}

/** Local wall-clock minutes (0..1439) for the given instant and timezone. */
export function localMinutes(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  return hour * 60 + minute;
}

export function isWithinQuietHours(window: QuietHoursWindow, minutes: number): boolean {
  const { startMinutes, endMinutes } = window;

  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }

  // Window crosses midnight (e.g. 22:00 -> 07:00).
  return minutes >= startMinutes || minutes < endMinutes;
}

/** Minutes until the quiet window ends, always greater than zero and at most 1440. */
export function minutesUntilQuietEnd(window: QuietHoursWindow, minutes: number): number {
  const { endMinutes } = window;

  return endMinutes > minutes ? endMinutes - minutes : endMinutes + 1440 - minutes;
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatLocalTime(instant: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  return formatter.format(instant);
}

function toMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');

  return Number(hours) * 60 + Number(minutes);
}
