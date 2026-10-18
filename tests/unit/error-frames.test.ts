import { describe, expect, it } from "vitest";
import { errorFrames } from "@/platform/error-frames";

describe("error frames for the logs", () => {
  it("keeps the call frames and never the message", () => {
    const error = new Error("Unique constraint failed on email alex@exemple.ca");
    const frames = errorFrames(error);
    expect(frames).toMatch(/^\s+at /);
    expect(frames).not.toContain("alex@exemple.ca");
    expect(frames).not.toContain("Unique constraint");
  });

  it("drops a multi-line message, even a line that looks like a frame", () => {
    const error = new Error("Invalid invocation:\n  at user alex@exemple.ca\n  where code = 123456");
    const frames = errorFrames(error);
    expect(frames).not.toContain("alex@exemple.ca");
    expect(frames).not.toContain("123456");
  });

  it("copes with what is not an error", () => {
    expect(errorFrames("alex@exemple.ca")).toBe("");
    expect(errorFrames(null)).toBe("");
    const bare = new Error("x");
    bare.stack = undefined;
    expect(errorFrames(bare)).toBe("");
  });

  it("filters a stack whose header was rewritten after construction", () => {
    const error = new Error("first");
    error.message = "alex@exemple.ca";
    expect(errorFrames(error)).not.toContain("alex@exemple.ca");
  });
});
