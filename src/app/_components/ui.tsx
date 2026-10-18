"use client";

import { createContext, useActionState, useContext, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/_lib/form-state";
import { FOCUS } from "./focus";

/**
 * What a form was last given back by its action. React 19 resets a form once its action has finished, whatever the
 * result, so the fields come back with their first values: a refused entry would lose its date, its kind and its
 * memo without a word. The action returns what was typed (`values`), and the fields of the form are remounted with it.
 */
type FormScopeValue = { values: Record<string, string> | undefined; attempt: number };
const FormScope = createContext<FormScopeValue>({ values: undefined, attempt: 0 });

/** useActionState for a form whose fields keep what was typed after a refusal (see FormScope). */
export function useScopedAction(action: (previous: FormState, formData: FormData) => Promise<FormState>) {
  const [state, formAction] = useActionState(action, undefined);
  const [seen, setSeen] = useState(state);
  const [attempt, setAttempt] = useState(0);
  if (state !== seen) {
    // adjusting state while rendering, the documented way to react to a new result without an effect
    setSeen(state);
    setAttempt(attempt + 1);
  }
  const scope: FormScopeValue = { values: state?.values, attempt };
  return { state, formAction, scope };
}

export function FormScopeProvider({ scope, children }: { scope: FormScopeValue; children: React.ReactNode }) {
  return <FormScope.Provider value={scope}>{children}</FormScope.Provider>;
}

export function Field(props: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  autoComplete?: string;
  hint?: string;
  inputMode?: "numeric" | "decimal" | "text";
  required?: boolean;
}) {
  const { name, label, type = "text", defaultValue, autoComplete, hint, inputMode, required = true } = props;
  const id = useId();
  const scope = useContext(FormScope);
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {/* No key here: React rewrites the default of an <input> when it changes, so the reset that follows an action
          restores the returned value and the field keeps the keyboard focus. Only a <select> must be remounted. */}
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={scope.values?.[name] ?? defaultValue}
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

export function SubmitButton({ children, variant = "primary", ariaLabel }: { children: React.ReactNode; variant?: "primary" | "secondary"; ariaLabel?: string }) {
  const { pending } = useFormStatus();
  const styles =
    variant === "primary"
      ? "bg-brand-700 text-white hover:bg-brand-800"
      : "border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800";
  return (
    // aria-disabled rather than disabled: a disabled button drops the keyboard focus when the form is submitted.
    <button
      type="submit"
      aria-label={ariaLabel}
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

export function Card({ title, children, headingLevel = 1 }: { title: string; children: React.ReactNode; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="mx-auto w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <Heading className="mb-4 text-xl font-semibold">{title}</Heading>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function CheckboxField(props: { name: string; label: string; defaultChecked?: boolean; hint?: string; required?: boolean }) {
  const { name, label, defaultChecked = false, hint, required = false } = props;
  const id = useId();
  const scope = useContext(FormScope);
  const checked = scope.values ? scope.values[name] === "on" : defaultChecked;
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <input key={scope.attempt} id={id} name={name} type="checkbox" defaultChecked={checked} required={required} aria-describedby={hint ? `${id}-hint` : undefined} className={`h-4 w-4 rounded border-stone-400 ${FOCUS}`} />
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Several checkboxes under one name; the returned value is the list joined by commas (see `listValues`). */
export function CheckboxGroup(props: { name: string; legend: string; options: { value: string; label: string }[]; defaultValues?: string[]; hint?: string }) {
  const { name, legend, options, defaultValues = [], hint } = props;
  const id = useId();
  const scope = useContext(FormScope);
  const selected = new Set(scope.values ? (scope.values[name] ?? "").split(",").filter(Boolean) : defaultValues);
  return (
    <fieldset aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => (
          <label key={`${scope.attempt}-${option.value}`} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={option.value} defaultChecked={selected.has(option.value)} className={`h-4 w-4 rounded border-stone-400 ${FOCUS}`} />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

export function TextAreaField(props: { name: string; label: string; defaultValue?: string; rows?: number; hint?: string }) {
  const { name, label, defaultValue, rows = 3, hint } = props;
  const id = useId();
  const scope = useContext(FormScope);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={scope.values?.[name] ?? defaultValue}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base shadow-sm dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The confirmation of a form state (a message under `notices`), announced politely. */
export function StateNotice({ state }: { state: FormState }) {
  const t = useTranslations("notices");
  if (!state?.notice) return null;
  return (
    <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
      {t(state.notice as "saved")}
    </p>
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
  const scope = useContext(FormScope);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select key={scope.attempt} id={id} name={name} defaultValue={scope.values?.[name] ?? defaultValue} required={required} aria-describedby={hint ? `${id}-hint` : undefined} className={CONTROL}>
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
  /** What assistive technology announces for the button, when the visible label alone does not say what it acts on. */
  ariaLabel?: string;
  variant?: "primary" | "secondary";
  children?: React.ReactNode;
}) {
  const { state, formAction, scope } = useScopedAction(props.action);
  return (
    <form action={formAction} className="space-y-3">
      <StateError state={state} />
      <StateNotice state={state} />
      <FormScopeProvider scope={scope}>{props.children}</FormScopeProvider>
      <SubmitButton variant={props.variant ?? "secondary"} ariaLabel={props.ariaLabel}>
        {props.label}
      </SubmitButton>
    </form>
  );
}

