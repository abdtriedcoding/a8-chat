import { v } from "convex/values";

const FALLBACK_TIME_ZONE = "UTC";

/**
 * The zones Chrome still lists under an old IANA name, such as
 * Asia/Calcutta, mapped to the name they have now. Not countries-and-
 * timezones' `aliasOf`, which also folds zones like Europe/Amsterdam into
 * another country's.
 */
const CURRENT_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/**
 * `zone`'s current IANA name, which can differ from the browser's. Saved
 * and shown zones go by it, so a zone has one name everywhere.
 */
export function currentTimeZoneName(zone: string): string {
  return CURRENT_NAMES[zone] ?? zone;
}

// The browser's IANA time zone, such as "Europe/Berlin", by its current
// name. Each Send and decideAction passes it so replies know the user's
// date.
export function browserTimeZone(): string {
  return currentTimeZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

// The browser's time zone, unchecked until resolveTimeZone runs on it.
export const vTimeZone = v.optional(v.string());

/** `timeZone` by its current name, or UTC when it isn't a time zone. */
export function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  const name = currentTimeZoneName(timeZone);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}
