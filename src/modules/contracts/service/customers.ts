import "server-only";
import { requireRole } from "@/modules/companies";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { CONTRACT_CUSTOMER_LIMIT, contractCustomerQuery } from "../domain/customer-search";

/** Minimal customer identity lookup; never load notes, addresses or tax registrations. */
export async function searchContractCustomers(actor: CompanyContext, query: unknown) {
  const q = contractCustomerQuery(query).replace(/[\\%_]/g, "\\$&");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.manage");
    await requireRole(tx, "contact.read");
    const rows = await tx.contact.findMany({
      where: { companyId: actor.companyId, anonymizedAt: null, isActive: true, isCustomer: true,
        OR: ["displayName", "legalName", "email"].map(field => ({ [field]: { contains: q, mode: "insensitive" as const } })) },
      select: { id: true, displayName: true, email: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }], take: CONTRACT_CUSTOMER_LIMIT + 1,
    });
    return { rows: rows.slice(0, CONTRACT_CUSTOMER_LIMIT), hasMore: rows.length > CONTRACT_CUSTOMER_LIMIT };
  });
}
