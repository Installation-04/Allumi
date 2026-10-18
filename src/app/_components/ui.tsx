"use client";

import { useId } from "react";
import { useFormStatus } from "react-dom";
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
