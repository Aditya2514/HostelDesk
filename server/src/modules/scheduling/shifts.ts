/**
 * Shift Calendar & Working-Time Arithmetic for HostelDesk.
 * 
 * All shifts and working windows operate strictly in Indian Standard Time (IST: UTC+05:30).
 * Since India does not observe Daylight Saving Time, the offset is permanently fixed at +330 minutes.
 */

export interface ShiftWindow {
  weekday: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startMinute: number; // minutes from midnight (e.g. 540 for 09:00)
  endMinute: number; // minutes from midnight (e.g. 1080 for 18:00)
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30 in milliseconds
const MAX_LOOKAHEAD_DAYS = 14;

export interface IstParts {
  year: number;
  month: number;
  date: number;
  weekday: number;
  minuteOfDay: number;
  second: number;
  ms: number;
}

/**
 * Converts a standard Date (UTC instant) into its IST calendar components.
 */
export function toIstParts(date: Date): IstParts {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: istDate.getUTCFullYear(),
    month: istDate.getUTCMonth(),
    date: istDate.getUTCDate(),
    weekday: istDate.getUTCDay(),
    minuteOfDay: istDate.getUTCHours() * 60 + istDate.getUTCMinutes(),
    second: istDate.getUTCSeconds(),
    ms: istDate.getUTCMilliseconds(),
  };
}

/**
 * Constructs a Date from IST calendar components.
 */
export function fromIstParts(
  year: number,
  month: number,
  date: number,
  minuteOfDay: number,
  second = 0,
  ms = 0
): Date {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const utcMillis = Date.UTC(year, month, date, hours, minutes, second, ms) - IST_OFFSET_MS;
  return new Date(utcMillis);
}

/**
 * Finds the next working instant at or after `from`.
 * If `from` is currently inside a working shift window, returns `from`.
 * If `shifts` is empty or no working window is found within 14 days, returns null.
 */
export function nextWorkingInstant(from: Date, shifts: ShiftWindow[]): Date | null {
  if (!shifts || shifts.length === 0) return null;

  const initialIst = toIstParts(from);
  let currentYear = initialIst.year;
  let currentMonth = initialIst.month;
  let currentDate = initialIst.date;
  let currentWeekday = initialIst.weekday;
  let currentMinute = initialIst.minuteOfDay;

  for (let dayOffset = 0; dayOffset <= MAX_LOOKAHEAD_DAYS; dayOffset++) {
    // Get all shifts for this weekday, sorted by startMinute
    const dayShifts = shifts
      .filter((s) => s.weekday === currentWeekday && s.endMinute > s.startMinute)
      .sort((a, b) => a.startMinute - b.startMinute);

    for (const shift of dayShifts) {
      // 1. If currently inside this shift window
      if (dayOffset === 0 && currentMinute >= shift.startMinute && currentMinute < shift.endMinute) {
        return from;
      }

      // 2. If this shift starts in the future on this day
      if (dayOffset > 0 || currentMinute < shift.startMinute) {
        return fromIstParts(currentYear, currentMonth, currentDate, shift.startMinute, 0, 0);
      }
    }

    // Advance to midnight of the next day
    const nextDayIst = new Date(
      Date.UTC(currentYear, currentMonth, currentDate + 1, 0, 0, 0, 0)
    );
    currentYear = nextDayIst.getUTCFullYear();
    currentMonth = nextDayIst.getUTCMonth();
    currentDate = nextDayIst.getUTCDate();
    currentWeekday = nextDayIst.getUTCDay();
    currentMinute = 0;
  }

  return null;
}

/**
 * Adds active working minutes to a start time, respecting staff shift windows,
 * lunch breaks, and non-working days.
 * 
 * Returns the completion Date, or null if the work cannot be scheduled within 14 days.
 */
export function addWorkingMinutes(
  start: Date,
  minutes: number,
  shifts: ShiftWindow[]
): Date | null {
  if (!shifts || shifts.length === 0 || minutes < 0) return null;
  if (minutes === 0) return nextWorkingInstant(start, shifts);

  // Jump to the first valid working instant
  let cursor = nextWorkingInstant(start, shifts);
  if (!cursor) return null;

  const maxDeadline = new Date(start.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  let remainingMinutes = minutes;

  while (remainingMinutes > 0) {
    if (cursor.getTime() > maxDeadline.getTime()) {
      return null;
    }

    const ist = toIstParts(cursor);
    // Find the active shift that covers the current cursor
    const activeShift = shifts.find(
      (s) => s.weekday === ist.weekday && ist.minuteOfDay >= s.startMinute && ist.minuteOfDay < s.endMinute
    );

    if (!activeShift) {
      // If cursor fell outside a shift, jump to the next shift window
      const nextInstant = nextWorkingInstant(cursor, shifts);
      if (!nextInstant || nextInstant.getTime() > maxDeadline.getTime()) return null;
      cursor = nextInstant;
      continue;
    }

    const availableMinutesInShift = activeShift.endMinute - ist.minuteOfDay;

    if (remainingMinutes <= availableMinutesInShift) {
      // The task finishes within the current shift window
      return fromIstParts(
        ist.year,
        ist.month,
        ist.date,
        ist.minuteOfDay + remainingMinutes,
        ist.second,
        ist.ms
      );
    }

    // Exhaust current shift window and advance to its end
    remainingMinutes -= availableMinutesInShift;
    const endOfShift = fromIstParts(
      ist.year,
      ist.month,
      ist.date,
      activeShift.endMinute,
      0,
      0
    );

    // Look for next shift window
    const nextStart = nextWorkingInstant(endOfShift, shifts);
    if (!nextStart || nextStart.getTime() > maxDeadline.getTime()) {
      return null;
    }
    cursor = nextStart;
  }

  return cursor;
}

/**
 * Calculates the total active working minutes between two dates (a and b),
 * counting only time that falls strictly within the staff member's shift windows.
 * Non-working hours, lunch breaks, and off days are completely excluded.
 */
export function workingMinutesBetween(
  a: Date,
  b: Date,
  shifts: ShiftWindow[]
): number {
  if (!shifts || shifts.length === 0 || b.getTime() <= a.getTime()) return 0;

  let cursor = nextWorkingInstant(a, shifts);
  if (!cursor || cursor.getTime() >= b.getTime()) return 0;

  let workedMinutes = 0;
  const maxLimit = new Date(a.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  while (cursor.getTime() < b.getTime()) {
    if (cursor.getTime() > maxLimit.getTime()) break;

    const ist = toIstParts(cursor);
    const activeShift = shifts.find(
      (s) =>
        s.weekday === ist.weekday &&
        ist.minuteOfDay >= s.startMinute &&
        ist.minuteOfDay < s.endMinute
    );

    if (!activeShift) {
      const nextInstant = nextWorkingInstant(cursor, shifts);
      if (!nextInstant || nextInstant.getTime() >= b.getTime()) break;
      cursor = nextInstant;
      continue;
    }

    const availableMinutesInShift = activeShift.endMinute - ist.minuteOfDay;
    const endOfShift = fromIstParts(
      ist.year,
      ist.month,
      ist.date,
      activeShift.endMinute,
      0,
      0
    );

    if (b.getTime() <= endOfShift.getTime()) {
      const deltaMinutes = (b.getTime() - cursor.getTime()) / (60 * 1000);
      workedMinutes += Math.max(0, deltaMinutes);
      break;
    } else {
      workedMinutes += availableMinutesInShift;
      const nextInstant = nextWorkingInstant(endOfShift, shifts);
      if (!nextInstant || nextInstant.getTime() >= b.getTime()) break;
      cursor = nextInstant;
    }
  }

  return Math.round(workedMinutes);
}
