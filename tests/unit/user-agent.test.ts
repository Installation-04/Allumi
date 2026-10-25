import { describe, expect, it } from "vitest";
import { describeUserAgent } from "@/modules/auth/domain/user-agent";

const cases: [string, string, string | null, string | null][] = [
  ["Chrome on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome", "Windows"],
  ["Edge, which also says Chrome and Safari", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge", "Windows"],
  ["Firefox on Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox", "Linux"],
  ["Safari on iPhone, which also says Mac OS X", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari", "iOS"],
  ["Chrome on Android, which also says Linux", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Chrome", "Android"],
  ["Safari on a Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Safari", "macOS"],
  ["the Windows client, which is Electron", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Allumi/0.4.0 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36", "Allumi", "Windows"],
];

describe("session device label", () => {
  it.each(cases)("recognises %s", (_name, agent, browser, system) => {
    expect(describeUserAgent(agent)).toEqual({ browser, system });
  });

  it("says nothing about an unknown, empty or missing User-Agent", () => {
    expect(describeUserAgent("curl/8.5.0")).toEqual({ browser: null, system: null });
    expect(describeUserAgent("")).toEqual({ browser: null, system: null });
    expect(describeUserAgent(null)).toEqual({ browser: null, system: null });
  });
});
