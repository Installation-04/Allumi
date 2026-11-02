import { notFound } from "next/navigation";

/** An explicit account scope must never silently become an all-account export. */
export function reportAccountId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value) && value.length !== 1) notFound();
  const id = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!id) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return id.toLowerCase();
}
