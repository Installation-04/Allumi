import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { acceptInvitation, getProfile, requireServerAccess, setServerAccess, sha256Hex } from "@/modules/auth";
import { changeMemberRole, getCompanyFor, inviteMember, listMembers, removeMember, revokeInvitation } from "@/modules/companies";
import { saveContact, listContacts } from "@/modules/contacts";
import { serverOverview, requestServerOperation } from "@/modules/server";
import { withCompany, withUser } from "@/platform/tenant";
import { hashPassword, verifyPassword } from "@/modules/auth/service/crypto";
import { owner, PASSWORD } from "./helpers";
import { seedWorld, W } from "./world";
const admin = { userId: W.userOwnerA, companyId: W.companyA };
const accountant = { ...admin, userId: W.userAccountant };
const viewer = { ...admin, userId: W.userReader };
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); await db.query("UPDATE user_credential SET password_hash=$1", [await hashPassword(PASSWORD)]); });
afterAll(async () => { await db?.end(); });
const join = (token: string, email: string, userId?: string) => acceptInvitation({ token, email, displayName: "Invited Person", password: PASSWORD }, randomUUID(), userId);
async function member(email: string, role = "USER", moduleAccess = {}) {
  const token = await inviteMember(admin, { email, role, moduleAccess });
  await join(token, email);
  const user = (await db.query("SELECT id FROM app_user WHERE email=$1", [email])).rows[0];
  const membership = (await listMembers(admin)).members.find(m => m.userId === user.id)!;
  return { actor: { ...admin, userId: user.id as string }, membership };
}
describe("company access management", () => {
  it("reserves invitations and member details to this company's admin", async () => {
    for (const actor of [accountant, viewer, { ...admin, userId: W.userOwnerB }]) {
      await expect(inviteMember(actor, { email: "bad@example.test", role: "OWNER" })).rejects.toMatchObject({ key: "forbidden" });
      await expect(listMembers(actor)).rejects.toMatchObject({ key: "forbidden" });
    }
    await expect(withCompany(accountant, tx => tx.invitation.create({ data: { companyId: W.companyA, email: "sql@example.test", role: "OWNER", tokenHash: "1".repeat(64), expiresAt: new Date(Date.now()+86400000), createdById: W.userAccountant } }))).rejects.toBeTruthy();
  });
  it("hashes one-time codes, consumes once even concurrently, and never grants instance administration", async () => {
    const email = "single@example.test";
    const token = await inviteMember(admin, { email, role: "OWNER" });
    expect((await db.query("SELECT token_hash FROM invitation WHERE email=$1", [email])).rows[0].token_hash).toBe(sha256Hex(token));
    const outcomes = await Promise.allSettled([join(token,email),join(token,email)]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const user = (await db.query("SELECT id FROM app_user WHERE email=$1", [email])).rows[0];
    expect(await getProfile(user.id)).toMatchObject({ isInstanceAdmin: false, canManageServer: false });
    await expect(join(token,email)).rejects.toMatchObject({ key: "members.invitationInvalid" });
    const audit = JSON.stringify((await db.query("SELECT before,after FROM audit_log WHERE entity_type='invitation'")).rows);
    expect(audit).not.toContain(token);
    expect(audit).not.toContain(sha256Hex(token));
  });
  it("revokes, expires and replaces invitations", async () => {
    const email = "revoked@example.test";
    const old = await inviteMember(admin, { email, role: "USER" });
    const current = await inviteMember(admin, { email, role: "READ_ONLY" });
    await expect(join(old,email)).rejects.toMatchObject({ key: "members.invitationInvalid" });
    const pending = (await listMembers(admin)).invitations.find(i => i.email===email)!;
    await revokeInvitation(admin,pending.id);
    await expect(join(current,email)).rejects.toMatchObject({ key: "members.invitationInvalid" });
    const expired = await inviteMember(admin, { email, role: "USER" });
    await db.query("UPDATE invitation SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[sha256Hex(expired)]);
    await expect(join(expired,email)).rejects.toMatchObject({ key: "members.invitationInvalid" });
  });
  it("requires the matching signed-in account and never changes its password", async () => {
    const token = await inviteMember({ companyId: W.companyB, userId: W.userOwnerB },{ email:"lecture@exemple.test",role:"ACCOUNTANT" });
    await expect(join(token,"lecture@exemple.test")).rejects.toMatchObject({ key:"members.invitationInvalid" });
    await expect(join(token,"lecture@exemple.test",W.userAccountant)).rejects.toMatchObject({ key:"members.invitationInvalid" });
    await expect(join(token,"lecture@exemple.test",W.userReader)).resolves.toBe(W.companyB);
    const hash = (await db.query("SELECT password_hash FROM user_credential WHERE user_id=$1",[W.userReader])).rows[0].password_hash;
    expect(await verifyPassword(hash,PASSWORD)).toBe(true);
  });
  it("gives users directory writes but no accounting writes by default", async () => {
    const { actor } = await member("user@example.test");
    await expect(saveContact(actor,{kind:"CUSTOMER",displayName:"Allowed contact"})).resolves.toHaveProperty("id");
    await expect(withCompany(actor,tx=>tx.account.updateMany({where:{companyId:W.companyA,id:W.sales},data:{nameEn:"Unauthorized"}}))).resolves.toMatchObject({count:0});
    await expect(inviteMember(actor,{email:"elevate@example.test",role:"OWNER"})).rejects.toMatchObject({key:"forbidden"});
  });
  it("applies custom no-access in the service and in direct database queries", async () => {
    const {actor,membership} = await member("restricted@example.test");
    await changeMemberRole(admin,membership.id,"USER",{ contacts:"none", catalog:"none", sales:"none", accounting:"none", taxes:"none" });
    await expect(listContacts(actor,{})).rejects.toMatchObject({key:"forbidden"});
    expect(await withCompany(actor,tx=>tx.contact.findMany({where:{companyId:W.companyA}}))).toEqual([]);
    expect(await withCompany(actor,tx=>tx.account.findMany({where:{companyId:W.companyA}}))).toEqual([]);
    await expect(withCompany(actor,tx=>tx.membership.updateMany({where:{id:membership.id},data:{moduleAccess:{accounting:"write"}}}))).resolves.toMatchObject({count:0});
  });
  it("can grant accounting writes to a user but cannot turn a viewer into a writer", async () => {
    const {actor,membership} = await member("custom@example.test");
    await changeMemberRole(admin,membership.id,"USER",{accounting:"write"});
    await expect(withCompany(actor,tx=>tx.account.updateMany({where:{id:W.sales,companyId:W.companyA},data:{nameEn:"Custom authorized"}}))).resolves.toMatchObject({count:1});
    await changeMemberRole(admin,membership.id,"READ_ONLY",{contacts:"write"});
    await expect(saveContact(actor,{kind:"CUSTOMER",displayName:"No viewer writes"})).rejects.toMatchObject({key:"forbidden"});
    await expect(withCompany(actor,tx=>tx.contact.updateMany({where:{companyId:W.companyA},data:{phone:"555"}}))).resolves.toMatchObject({count:0});
  });
  it("rejects incompatible or unknown module settings", async () => {
    await expect(inviteMember(admin,{email:"invalid@example.test",role:"USER",moduleAccess:{sales:"write",accounting:"read"}})).rejects.toMatchObject({key:"members.dependencies"});
    await expect(inviteMember(admin,{email:"invalid@example.test",role:"USER",moduleAccess:{server:"write"}})).rejects.toMatchObject({key:"members.invalid"});
  });
  it("removes company access immediately, preserves the identity and audit trail, refuses self-removal", async () => {
    const {actor,membership} = await member("removed@example.test");
    await removeMember(admin,membership.id);
    expect(await getCompanyFor(actor.userId,actor.companyId)).toBeNull();
    expect(await getProfile(actor.userId)).not.toBeNull();
    const self=(await listMembers(admin)).members.find(m=>m.userId===admin.userId)!;
    await expect(removeMember(admin,self.id)).rejects.toMatchObject({key:"members.self"});
    const events=await db.query("SELECT action FROM audit_log WHERE entity_type='membership' AND entity_id=$1",[membership.id]);
    expect(events.rows.some(r=>r.action==='row.delete')).toBe(true);
  });
  it("prevents cross-company changes even from another company administrator", async () => {
    const other=(await listMembers({userId:W.userOwnerB,companyId:W.companyB})).members[0]!;
    await expect(changeMemberRole(admin,other.id,"USER")).rejects.toMatchObject({key:"members.notFound"});
    await expect(removeMember(admin,other.id)).rejects.toMatchObject({key:"members.notFound"});
  });
});
describe("global server delegation", () => {
  it("requires a super administrator and their password; an ordinary admin cannot grant it", async () => {
    await expect(setServerAccess(W.userOwnerB,W.userReader,true,PASSWORD)).rejects.toMatchObject({key:"forbidden"});
    await expect(setServerAccess(W.userOwnerA,W.userReader,true,"wrong")).rejects.toMatchObject({key:"server.password"});
    await expect(withUser({userId:W.userReader},tx=>tx.$executeRaw`SELECT app_set_server_access(${W.userReader}::uuid,true)`)).rejects.toBeTruthy();
    await expect(requireServerAccess(W.userReader)).rejects.toMatchObject({key:"forbidden"});
    await setServerAccess(W.userOwnerA,W.userReader,true,PASSWORD);
    await expect(requireServerAccess(W.userReader)).resolves.toMatchObject({canManageServer:true});
    const overview=await serverOverview(W.userReader);
    expect(overview).toMatchObject({enabled:false,databaseHealthy:true});
    expect(JSON.stringify(overview)).not.toContain(process.env.ENCRYPTION_KEY);
    await expect(requestServerOperation(W.userReader,{operation:"backup"})).rejects.toMatchObject({key:"server.disabled"});
    await setServerAccess(W.userOwnerA,W.userReader,false,PASSWORD);
    await expect(serverOverview(W.userReader)).rejects.toMatchObject({key:"forbidden"});
  });
});
