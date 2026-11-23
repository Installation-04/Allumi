"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { previewMigration, confirmMigration, decodeMigrationCsv, MAX_MIGRATION_BYTES, type MigrationPreview } from "@/modules/migration";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
export type MigrationActionState = NonNullable<FormState> & { preview?: MigrationPreview; reviewKey?: string };
export async function migrationAction(companyId: string, _previous: MigrationActionState, form: FormData): Promise<MigrationActionState> {
  let preview: MigrationPreview | undefined, reviewKey = "";
  const result = await safeAction(async () => {
    const { userId } = await requireSession();
    for (const key of ["spec", "intent", "token", "ack", "reviewKey", "file"]) if (form.getAll(key).length > 1) throw new AppError("migration.invalid");
    const file = form.get("file"), raw = form.get("spec"), key = form.get("reviewKey"), intent = form.get("intent");
    if (!(file instanceof File) || !file.size || file.size > MAX_MIGRATION_BYTES || typeof raw !== "string" || raw.length > 20000 || typeof key !== "string" || key.length > 20000) throw new AppError("migration.invalid");
    reviewKey = key;
    let spec: unknown; try { spec = JSON.parse(raw); } catch { throw new AppError("migration.invalid"); }
    let text: string; try { text = decodeMigrationCsv(new Uint8Array(await file.arrayBuffer())); } catch { throw new AppError("migration.invalid"); }
    const actor = { userId, companyId };
    if (intent === "preview") { preview = await previewMigration(actor, text, spec); return undefined; }
    if (intent !== "confirm" || typeof form.get("token") !== "string") throw new AppError("migration.confirm");
    const imported = await confirmMigration(actor, text, spec, String(form.get("token")), form.get("ack") === "yes");
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/migration?lot=${imported.id}`);
  });
  return { ...result, preview, reviewKey };
}
