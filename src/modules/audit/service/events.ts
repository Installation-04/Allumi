import "server-only";
import type { Tx } from "@/platform/tenant";

export type AuditEvent = {
  /** `domain.verb`, e.g. `auth.login`. */
  action: string;
  entityType: string;
  entityId?: string;
  data?: Record<string, unknown>;
  /** Event outside any company (sign-in…). */
  global?: boolean;
  /** User the event is about, who can see it (e.g. a failed sign-in). */
  subjectUserId?: string;
};

/**
 * The application cannot write to audit_log directly: events go through the SECURITY DEFINER
 * function app_audit_event, which imposes the actor, the validated company and the timestamp.
 */
export async function recordEvent(tx: Tx, event: AuditEvent): Promise<void> {
  const data = event.data ? JSON.stringify(event.data) : null;
  await tx.$executeRaw`SELECT app_audit_event(
    ${event.action}, ${event.entityType}, ${event.entityId ?? null}, ${data}::jsonb,
    ${event.global ?? false}, ${event.subjectUserId ?? null}::uuid)`;
}
