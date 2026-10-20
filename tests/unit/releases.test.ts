import { describe, expect, it } from "vitest";
import { compareVersions, selectRelease } from "@/modules/updates";
describe("release channels and version ordering", () => {
  it("orders numerically and promotes prereleases to stable", () => {
    for (const [a, b] of [["0.10.0", "0.9.9"], ["0.2.0", "0.2.0-rc.9"], ["0.2.0-beta.1", "0.2.0-alpha.8"], ["0.2.0-alpha.10", "0.2.0-alpha.2"]]) expect(compareVersions(a!, b!)).toBeGreaterThan(0);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
  });
  it("excludes drafts, malformed tags and previews on the stable channel", () => {
    const releases = [{ tag_name: "v0.1.0", draft: false }, { tag_name: "v0.2.0-alpha.1", prerelease: true }, { tag_name: "v9.0.0", draft: true }, { tag_name: "v1.0.0;evil" }];
    expect(selectRelease(releases, false)?.tag).toBe("v0.1.0");
    expect(selectRelease(releases, true)?.tag).toBe("v0.2.0-alpha.1");
    expect(selectRelease([], false)).toBeNull();
    expect(() => compareVersions("dev", "0.1.0")).toThrow();
  });
});
