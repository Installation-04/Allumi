import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), write: vi.fn(), link: vi.fn(), unlink: vi.fn(), audit: vi.fn() }));
vi.mock("@/modules/auth", () => ({ requireServerAccess: mocks.access }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), writeFile: mocks.write, link: mocks.link, unlink: mocks.unlink }));
vi.mock("@/modules/audit", () => ({ recordEvent: mocks.audit }));
vi.mock("@/platform/tenant", () => ({ withUser: (_actor: unknown, run: (tx: unknown) => Promise<void>) => run({}) }));
import { requestServerOperation } from "@/modules/server";
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({}); mocks.write.mockResolvedValue(undefined); mocks.link.mockResolvedValue(undefined); mocks.unlink.mockResolvedValue(undefined); mocks.audit.mockResolvedValue(undefined); vi.stubEnv("ALLUMI_SERVER_ADMIN_ENABLED", "1"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("server operation boundary", () => {
  it("checks authorization before touching the control directory", async () => {
    mocks.access.mockRejectedValueOnce(new Error("forbidden"));
    await expect(requestServerOperation("user",{operation:"backup"})).rejects.toThrow("forbidden");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("ignores supplied paths and commands, records the actor, and queues atomically", async () => {
    await requestServerOperation("actor",{operation:"backup",command:"id",path:"/etc/shadow"});
    const payload=JSON.parse(mocks.write.mock.calls[0]![1]);
    expect(payload).toMatchObject({operation:"backup",actor:"actor"});
    expect(payload.command).toBeUndefined();
    expect(payload.path).toBeUndefined();
    expect(mocks.write.mock.calls[0]![2]).toEqual({flag:"wx",mode:0o600});
    expect(mocks.link.mock.calls[0]![1]).toBe("/app/storage/server-control/request.json");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:"server.request",global:true}));
  });
  it("rejects invalid operations and out-of-range retention", async () => {
    for(const input of [{operation:"shell"},{operation:"retention",days:0},{operation:"retention",days:3651}]) await expect(requestServerOperation("actor",input)).rejects.toMatchObject({key:"server.invalid"});
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not overwrite a pending request and removes its temporary file", async () => {
    mocks.link.mockRejectedValueOnce(Object.assign(new Error("exists"),{code:"EEXIST"}));
    await expect(requestServerOperation("actor",{operation:"backup"})).rejects.toMatchObject({key:"server.pending"});
    expect(mocks.unlink).toHaveBeenCalledOnce();
  });
});
