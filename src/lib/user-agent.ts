const BROWSERS: [string, RegExp][] = [
  // Edge and Opera also say Chrome, and Chrome also says Safari, so the
  // more specific names come first.
  ["Edge", /Edg(?:e|A|iOS)?\//],
  ["Opera", /OPR\/|Opera/],
  ["Firefox", /Firefox\/|FxiOS\//],
  ["Chrome", /Chrome\/|CriOS\//],
  ["Safari", /Safari\//],
];

const SYSTEMS: [string, RegExp][] = [
  // iPhone UAs say "like Mac OS X", and Android UAs say "Linux".
  ["iPhone", /iPhone/],
  ["iPad", /iPad/],
  ["Android", /Android/],
  ["Windows", /Windows/],
  ["macOS", /Macintosh|Mac OS X/],
  ["Linux", /Linux|X11/],
];

/**
 * A short device label from a User-Agent, like "Chrome on Windows". It
 * knows the common browsers and systems, and says "Unknown device" for
 * anything else.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  const system = SYSTEMS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}
