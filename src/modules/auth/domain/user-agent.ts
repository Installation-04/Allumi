// Short label for a session's User-Agent header ("Firefox", "Windows"), so people can recognise their devices.
// Order matters: Edge and Opera also say Chrome, Chrome also says Safari, Android also says Linux, iOS says Mac.

const BROWSERS: [RegExp, string][] = [
  [/\b(?:Edg|EdgA|EdgiOS)\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bElectron\//, "Allumi"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\bWindows\b/, "Windows"],
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

export type DeviceLabel = { browser: string | null; system: string | null };

export function describeUserAgent(userAgent: string | null | undefined): DeviceLabel {
  const value = userAgent ?? "";
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(value))?.[1] ?? null,
    system: SYSTEMS.find(([pattern]) => pattern.test(value))?.[1] ?? null,
  };
}
