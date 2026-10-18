import { describe, expect, it } from "vitest";
import { setupGate } from "@/modules/auth/domain/setup-gate";

describe("setup gate", () => {
  const token = "0123456789abcdef";
  it("asks for the token whenever one is configured", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      for (const appUrl of ["http://localhost:3000", "https://compta.exemple.ca"]) expect(setupGate({ nodeEnv, appUrl, token })).toBe("token_required");
    }
  });

  it("stays closed on a real deployment (production, HTTPS) without a token", () => {
    expect(setupGate({ nodeEnv: "production", appUrl: "https://compta.exemple.ca", token: undefined })).toBe("token_missing");
  });

  it("stays open in development, tests and over plain HTTP", () => {
    expect(setupGate({ nodeEnv: "development", appUrl: "https://compta.exemple.ca", token: undefined })).toBe("open");
    expect(setupGate({ nodeEnv: "test", appUrl: "http://localhost:3000", token: undefined })).toBe("open");
    expect(setupGate({ nodeEnv: "production", appUrl: "http://127.0.0.1:3100", token: undefined })).toBe("open");
  });
});
