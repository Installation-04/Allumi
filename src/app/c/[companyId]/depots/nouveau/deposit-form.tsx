"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@/modules/ledger/client";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import type { FormState } from "@/app/_lib/form-state";
import { FOCUS } from "@/app/_components/focus";
import type { PaymentMethodKind } from "@/modules/payments";
type Receipt = {
  id: string;
  number: string;
  date: string;
  amountCents: string;
  method: PaymentMethodKind;
  reference: string | null;
  eligibleDate: string;
};
function ReceiptPicker({
  receipts,
  selected,
  toggle,
}: {
  receipts: Receipt[];
  selected: Set<string>;
  toggle: (id: string) => void;
}) {
  const { pending } = useFormStatus();
  const t = useTranslations("deposits");
  const methods = useTranslations("payments.methods");
  const locale = useLocale() === "en" ? "en" : "fr-CA";
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 font-semibold"><h2>{t("selectReceipts")}</h2></legend>
      {receipts.map((p) => (
        <label
          key={p.id}
          className={`flex min-h-11 cursor-pointer items-start gap-3 rounded border border-stone-300 p-3 dark:border-stone-700 ${FOCUS}`}
        >
          <input
            type="checkbox"
            name="paymentId"
            value={p.id}
            checked={selected.has(p.id)}
            onChange={() => toggle(p.id)}
            disabled={pending}
            className="mt-1 size-5 shrink-0"
            aria-label={t("selectNamed", { number: p.number })}
          />
          <span className="min-w-0 flex-1 break-words text-sm">
            <span className="font-medium">
              {p.number} · {formatMoney(BigInt(p.amountCents), locale)}
            </span>
            <span className="block">
              {p.date} · {methods(p.method)}
              {p.reference ? ` · ${p.reference}` : ""}
            </span>
            {p.eligibleDate > p.date ? (
              <span className="block">
                {t("eligible", { date: p.eligibleDate })}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
export function DepositForm({
  action,
  receipts,
  accounts,
  date,
}: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  receipts: Receipt[];
  accounts: { value: string; label: string }[];
  date: string;
}) {
  const t = useTranslations("deposits");
  const locale = useLocale() === "en" ? "en" : "fr-CA";
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const selected = receipts.filter((p) => ids.has(p.id));
  const total = selected.reduce((s, p) => s + BigInt(p.amountCents), 0n);
  const eligible = selected.reduce(
    (last, p) => (p.eligibleDate > last ? p.eligibleDate : last),
    "",
  );
  const toggle = (id: string) =>
    setIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ActionForm
      action={action}
      label={t("submit")}
      variant="primary"
      preserveOnReset
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="date" label={t("date")} type="date" defaultValue={date} />
        <SelectField
          name="accountId"
          label={t("account")}
          defaultValue=""
          options={[{ value: "", label: t("chooseAccount") }, ...accounts]}
        />
        <Field
          name="reference"
          label={t("reference")}
          required={false}
          autoComplete="off"
        />
      </div>
      <ReceiptPicker receipts={receipts} selected={ids} toggle={toggle} />
      <input type="hidden" name="expectedTotalCents" value={String(total)} />
      <div
        role="status"
        className="rounded bg-brand-50 p-3 font-medium dark:bg-stone-800"
      >
        {t("selected", {
          count: selected.length,
          amount: formatMoney(total, locale),
        })}
        {eligible ? (
          <p className="mt-1 text-sm">{t("earliest", { date: eligible })}</p>
        ) : null}
      </div>
      <p className="text-sm">{t("postingHint")}</p>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          className="mt-1 size-5 shrink-0"
          type="checkbox"
          name="confirm"
          value="yes"
          required
        />
        {t("confirm")}
      </label>
    </ActionForm>
  );
}
