const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Formats a Date/timestamp into friendly IST display:
 * e.g. "Today 5:30 PM", "Tomorrow 10:00 AM", or "Tue 10:00 AM"
 */
export function formatFriendlyIst(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);

  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, "0");
  const timeStr = `${displayHours}:${displayMinutes} ${ampm}`;

  const isSameDay =
    istDate.getUTCFullYear() === istNow.getUTCFullYear() &&
    istDate.getUTCMonth() === istNow.getUTCMonth() &&
    istDate.getUTCDate() === istNow.getUTCDate();

  if (isSameDay) {
    return `Today ${timeStr}`;
  }

  const tomorrowIst = new Date(istNow.getTime() + 24 * 60 * 60 * 1000);
  const isTomorrow =
    istDate.getUTCFullYear() === tomorrowIst.getUTCFullYear() &&
    istDate.getUTCMonth() === tomorrowIst.getUTCMonth() &&
    istDate.getUTCDate() === tomorrowIst.getUTCDate();

  if (isTomorrow) {
    return `Tomorrow ${timeStr}`;
  }

  const weekdayName = WEEKDAYS[istDate.getUTCDay()];
  return `${weekdayName} ${timeStr}`;
}
