import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";

const mocks = vi.hoisted(() => ({ session: vi.fn(), requireSession: vi.fn(), profile: vi.fn(), status: vi.fn() }));
vi.mock("@/app/_lib/session", () => ({ getSession: mocks.session, requireSession: mocks.requireSession }));
vi.mock("@/modules/auth", () => ({ getProfile: mocks.profile }));
vi.mock("@/modules/updates", () => ({ getUpdateStatus: mocks.status }));
vi.mock("@/platform/version", () => ({ appVersion: () => "0.4.0-alpha.46" }));

import { GET } from "@/app/administration/serveur/mises-a-jour/etat/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "server-operator", mfaPending: false });
  mocks.requireSession.mockResolvedValue({ userId: "server-operator", mfaPending: false });
  mocks.profile.mockResolvedValue({ isInstanceAdmin: true, canManageServer: false });
  mocks.status.mockResolvedValue({ state: "running", stage: "backup", target: "v0.4.0-alpha.47" });
});

function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Cache-Control")).toContain("private");
  expect(response.headers.get("Vary")).toBe("Cookie");
}

describe("web update polling authorization boundary", () => {
  it.each([null, { userId: "server-operator", mfaPending: true }])("refuses missing or incomplete authentication before reading the profile or status (%j)", async session => {
    mocks.session.mockResolvedValue(session);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expectPrivate(response);
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it.each([null, { role: "OWNER", isInstanceAdmin: false, canManageServer: false }, { role: "ADMIN", isInstanceAdmin: false, canManageServer: false }, { role: "ACCOUNTANT", isInstanceAdmin: false, canManageServer: false }])("does not infer server access from a company role or an unavailable profile (%j)", async profile => {
    mocks.profile.mockResolvedValue(profile);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expectPrivate(response);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it.each([{ isInstanceAdmin: true, canManageServer: false }, { isInstanceAdmin: false, canManageServer: true }])("allows explicitly authorized global server access (%j)", async profile => {
    mocks.profile.mockResolvedValue(profile);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ currentVersion: "0.4.0-alpha.46", status: { state: "running", stage: "backup", target: "v0.4.0-alpha.47" } });
    expectPrivate(response);
    expect(mocks.profile).toHaveBeenCalledWith("server-operator");
    expect(mocks.status).toHaveBeenCalledWith("server-operator");
  });

  it("fails closed if server permission is revoked between the route and service checks", async () => {
    mocks.status.mockRejectedValue(new AppError("updates.forbidden", "private host detail"));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expectPrivate(response);
  });

  it("returns a private generic failure when status reading fails", async () => {
    mocks.status.mockRejectedValue(new Error("sensitive host path or error"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expectPrivate(response);
  });
});
