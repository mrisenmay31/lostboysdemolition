import type { ReactNode } from "react";

/**
 * Generic labeled field wrapper — label + child input/control + optional
 * hint or error text. Shared across the whole builder so every field gets
 * the same spacing/typography without repeating it at every call site.
 */
interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

/** Shared Tailwind classes for a bare `<input>`/`<select>`, so every field
 *  in the builder looks and behaves the same (large touch target — Dane
 *  and Jackson estimate on phones — matching web/src/app/login/LoginForm.tsx's
 *  precedent). */
export const fieldInputClass =
  "h-12 w-full rounded-lg border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100";

export const fieldTextareaClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100";

/** Read-only "computed value" display — used where itemized mode replaces
 *  an editable input with a sum derived from scope line items. */
export const readOnlyValueClass =
  "flex h-12 w-full items-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 text-base text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300";
