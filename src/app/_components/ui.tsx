"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/_lib/form-state";
import { FOCUS } from "./focus";

export function Field(props: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  autoComplete?: string;
  hint?: string;
  inputMode?: "numeric" | "text";
  required?: boolean;
}) {
  const { name, label, type = "text", defaultValue, autoComplete, hint, inputMode, required = true } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        aria-describedby={hint ? hintId : undefined}
        className={`w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base shadow-sm dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}
      />
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const styles =
    variant === "primary"
      ? "bg-brand-700 text-white hover:bg-brand-800"
      : "border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800";
  return (
    // aria-disabled rather than disabled: a disabled button drops the keyboard focus when the form is submitted.
    <button
      type="submit"
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={`rounded-md px-4 py-2 text-sm font-medium aria-disabled:opacity-60 ${FOCUS} ${styles}`}
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {message}
    </p>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** The error of a form state, whichever catalog it comes from. */
export function StateError({ state }: { state: FormState }) {
  const t = useTranslations("errors");
  if (state?.messageKey) return <FormError message={t(state.messageKey as "forbidden")} />;
  if (state?.error) return <FormError message={t(`form.${state.error}`, { min: 12 })} />;
  return null;
}

const CONTROL = `w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base shadow-sm dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;

export function SelectField(props: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean; hint?: string }) {
  const { name, label, options, defaultValue, required = true, hint } = props;
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select id={id} name={name} defaultValue={defaultValue} required={required} aria-describedby={hint ? `${id}-hint` : undefined} className={CONTROL}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A small form around one server action (lock a period, reverse an entry...): its error is shown in place and
 * the page is refreshed by the action itself. Extra fields (a reason, a date) go in `children`.
 */
export function ActionForm(props: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  variant?: "primary" | "secondary";
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(props.action, undefined);
  return (
    <form action={formAction} className="space-y-3">
      <StateError state={state} />
      {props.children}
      <SubmitButton variant={props.variant ?? "secondary"}>{props.label}</SubmitButton>
    </form>
  );
}

export const TABLE_CLASS = "w-full border-collapse text-sm";
export const TH_CLASS = "border-b border-stone-300 px-2 py-2 text-left font-semibold dark:border-stone-700";
export const TD_CLASS = "border-b border-stone-200 px-2 py-2 align-top dark:border-stone-800";
