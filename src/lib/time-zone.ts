/**
 * The browser's IANA time zone, such as "Europe/Berlin". Every Send passes
 * it so replies know the user's date; the server checks it and falls back
 * to UTC.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
