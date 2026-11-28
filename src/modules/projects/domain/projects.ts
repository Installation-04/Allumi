import { z } from "zod";
export const PROJECT_PAGE_SIZE = 50, PROJECT_CUSTOMER_LIMIT = 20;
export const PROJECT_STATES = ["ACTIVE", "ARCHIVED"] as const;
export const PROJECT_CODE = /^[A-Z0-9][A-Z0-9._-]{0,29}$/;
const line = (min: number, max: number) => z.string().refine(s => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s)).transform(s => s.trim()).refine(s => [...s].length >= min && [...s].length <= max);
export const projectInput = z.object({ code: z.string().trim().toUpperCase().regex(PROJECT_CODE), name: line(1, 120), description: line(0, 500), customerId: z.uuid().nullable().optional() });
export type ProjectInput = z.infer<typeof projectInput>;
export type ProjectDto = {
    id: string;
    code: string;
    name: string;
    description: string;
    status: typeof PROJECT_STATES[number];
    revision: number;
    hasCustomer: boolean;
    customerId?: string | null;
    customerName?: string | null;
};
export type ProjectFilters = {
    q: string;
    status: "ALL" | typeof PROJECT_STATES[number];
    page: number;
};
export function projectFilters(input: Record<string, string | string[] | undefined>): ProjectFilters {
    const one = (k: string, d: string) => { const v = input[k]; if (v === undefined)
        return d; if (typeof v !== "string")
        throw new RangeError('project filters'); return v; };
    const q = one('q', '').trim(), status = one('statut', 'ACTIVE'), page = one('page', '1');
    if ([...q].length > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(q) || !['ALL', ...PROJECT_STATES].includes(status) || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)))
        throw new RangeError('project filters');
    return { q, status: status as ProjectFilters['status'], page: Number(page) };
}
export function projectQuery(f: ProjectFilters, page?: number) { const q = new URLSearchParams({ statut: f.status }); if (f.q)
    q.set('q', f.q); if (page !== undefined)
    q.set('page', String(page)); return q.toString(); }
export function projectCustomerQuery(value: unknown): string { if (typeof value !== 'string')
    throw new RangeError('client query'); const s = value.trim(); if ([...s].length < 2 || [...s].length > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(s))
    throw new RangeError('client query'); return s; }
export type ProjectCustomerChoice = {
    id: string;
    displayName: string;
};
