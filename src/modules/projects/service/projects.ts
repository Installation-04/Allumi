import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { projectInput, projectFilters, projectCustomerQuery, PROJECT_PAGE_SIZE, PROJECT_CUSTOMER_LIMIT, PROJECT_CODE, type ProjectInput, type ProjectDto, type ProjectFilters, type ProjectCustomerChoice } from "../domain/projects";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const select = { id: true, code: true, name: true, description: true, status: true, revision: true, customerId: true } as const;
function valid(input: ProjectInput) { const r = projectInput.safeParse(input); if (!r.success)
    throw new AppError('project.invalid'); return r.data; }
async function customer(tx: Tx, companyId: string, id: string | null | undefined) { if (!id)
    return; await requireRole(tx, 'contact.read'); const [r] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT public.project_lock_customer(${companyId}::uuid,${id}::uuid) AS ok`; if (!r?.ok)
    throw new AppError('project.customerUnavailable'); }
async function dto(tx: Tx, companyId: string, row: {
    id: string;
    code: string;
    name: string;
    description: string;
    status: string;
    revision: number;
    customerId: string | null;
}): Promise<ProjectDto> {
    if (row.status !== 'ACTIVE' && row.status !== 'ARCHIVED')
        throw new AppError('project.invalid');
    const { customerId, ...rest } = row, result: ProjectDto = { ...rest, status: row.status, hasCustomer: !!customerId };
    const [access] = await tx.$queryRaw<{
        ok: boolean;
    }[]> `SELECT app_module_level('contacts')<>'none' AS ok`;
    if (access?.ok) {
        result.customerId = customerId;
        result.customerName = customerId ? (await tx.contact.findFirst({ where: { companyId, id: customerId, anonymizedAt: null }, select: { displayName: true } }))?.displayName ?? null : null;
    }
    return result;
}
export async function getProject(actor: CompanyContext, id: string) { if (!UUID.test(id))
    throw new AppError('project.notFound'); return withCompany(actor, async (tx) => { await requireRole(tx, 'project.read'); const r = await tx.project.findFirst({ where: { companyId: actor.companyId, id }, select }); if (!r)
    throw new AppError('project.notFound'); return dto(tx, actor.companyId, r); }); }
export async function getProjectByCode(actor: CompanyContext, code: string) { code = code.trim().toUpperCase(); if (!PROJECT_CODE.test(code))
    throw new AppError('project.invalid'); return withCompany(actor, async (tx) => { await requireRole(tx, 'project.read'); const r = await tx.project.findFirst({ where: { companyId: actor.companyId, code }, select: { id: true, code: true, name: true, status: true } }); if (!r)
    throw new AppError('project.notFound'); return r; }); }
export async function createProject(actor: CompanyContext, input: ProjectInput) { const data = valid(input); try {
    return await withCompany(actor, async (tx) => { await requireRole(tx, 'project.manage'); await customer(tx, actor.companyId, data.customerId); return (await tx.project.create({ data: { companyId: actor.companyId, ...data }, select: { id: true } })).id; });
}
catch (e) {
    if (isConflict(e))
        throw new AppError('project.codeExists');
    throw e;
} }
async function lock(tx: Tx, actor: CompanyContext, id: string, revision: number) { if (!UUID.test(id) || !Number.isSafeInteger(revision) || revision < 1 || revision >= 2147483647)
    throw new AppError('project.invalid'); const [r] = await tx.$queryRaw<{
    id: string;
    code: string;
    name: string;
    description: string;
    customerId: string | null;
    status: string;
    revision: number;
}[]> `SELECT id,code,name,description,customer_id AS "customerId",status,revision FROM project WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`; if (!r)
    throw new AppError('project.notFound'); if (r.revision !== revision)
    throw new AppError('project.stale'); return r; }
export async function updateProject(actor: CompanyContext, id: string, revision: number, input: ProjectInput) { const data = valid(input); return withCompany(actor, async (tx) => { await requireRole(tx, 'project.manage'); const old = await lock(tx, actor, id, revision); if (old.status !== 'ACTIVE')
    throw new AppError('project.archived'); if (data.code !== old.code)
    throw new AppError('project.codeImmutable'); if (data.customerId !== undefined && data.customerId !== old.customerId) {
    await requireRole(tx, 'contact.read');
    await customer(tx, actor.companyId, data.customerId);
} if ((await tx.project.updateMany({ where: { companyId: actor.companyId, id, revision }, data: { name: data.name, description: data.description, ...(data.customerId !== undefined ? { customerId: data.customerId } : {}), revision: revision + 1 } })).count !== 1)
    throw new AppError('forbidden'); }); }
export async function setProjectArchived(actor: CompanyContext, id: string, revision: number, archived: boolean, confirmed: boolean) { if (confirmed !== true)
    throw new AppError('project.confirm'); return withCompany(actor, async (tx) => { await requireRole(tx, 'project.manage'); const old = await lock(tx, actor, id, revision), status = archived ? 'ARCHIVED' : 'ACTIVE'; if (old.status === status)
    throw new AppError('project.stale'); if ((await tx.project.updateMany({ where: { companyId: actor.companyId, id, revision }, data: { status, revision: revision + 1 } })).count !== 1)
    throw new AppError('forbidden'); }); }
export async function listProjects(actor: CompanyContext, input: ProjectFilters) { const f = projectFilters({ q: input.q, statut: input.status, page: String(input.page) }); return withCompany(actor, async (tx) => { await requireRole(tx, 'project.read'); const [r] = await tx.$queryRaw<{
    rows: Pick<ProjectDto, 'id' | 'code' | 'name' | 'status' | 'revision'>[];
    count: string;
    page: string;
    pages: string;
}[]> `WITH filtered AS (SELECT id,code,name,status,revision FROM project WHERE company_id=${actor.companyId}::uuid AND (${f.status}='ALL' OR status=${f.status}) AND position(lower(${f.q}) IN lower(code||' '||name))>0), summary AS(SELECT count(*) AS n FROM filtered), paging AS(SELECT *,least(${f.page}::bigint,greatest(1,(n+${PROJECT_PAGE_SIZE - 1})/${PROJECT_PAGE_SIZE})) AS page,greatest(1,(n+${PROJECT_PAGE_SIZE - 1})/${PROJECT_PAGE_SIZE}) AS pages FROM summary) SELECT n::text AS count,page::text,pages::text,coalesce((SELECT jsonb_agg(detail ORDER BY detail.code,detail.id) FROM (SELECT * FROM filtered ORDER BY code,id LIMIT ${PROJECT_PAGE_SIZE} OFFSET (page-1)*${PROJECT_PAGE_SIZE})detail),'[]'::jsonb) AS rows FROM paging`; if (!r || ![r.count, r.page, r.pages].every(x => Number.isSafeInteger(Number(x))))
    throw new AppError('project.limit'); return { filters: f, rows: r.rows, count: Number(r.count), page: Number(r.page), pages: Number(r.pages) }; }); }
export async function searchProjectCustomers(actor: CompanyContext, input: unknown) { const q = projectCustomerQuery(input); return withCompany(actor, async (tx) => { await requireRole(tx, 'project.manage'); await requireRole(tx, 'contact.read'); const rows = await tx.$queryRaw<ProjectCustomerChoice[]> `SELECT id,display_name AS "displayName" FROM contact WHERE company_id=${actor.companyId}::uuid AND is_customer AND is_active AND anonymized_at IS NULL AND position(lower(${q}) IN lower(display_name))>0 ORDER BY display_name,id LIMIT ${PROJECT_CUSTOMER_LIMIT + 1}`; return { rows: rows.slice(0, PROJECT_CUSTOMER_LIMIT), hasMore: rows.length > PROJECT_CUSTOMER_LIMIT }; }); }
