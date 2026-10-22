import { useState, type FormEvent } from "react";
import { ApiError } from "./api";
import type { FieldError } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const checks = {
  email: (v: string) => (!v.trim() ? "Enter your email address" : EMAIL.test(v.trim()) ? null : "Enter an email address in the right format, like name@example.com"),
  password: (v: string) => (v ? null : "Enter your password"),
  newPassword: (v: string) => (!v ? "Create a password" : v.length < 8 ? "Password must be at least 8 characters" : null),
  required: (msg: string) => (v: string) => (v.trim() ? null : msg),
};

// Validates on submit only, then hands server errors to the same summary.
// serverField says which field a server-side failure belongs to, so its link lands somewhere useful.
export function useSubmit<T extends Record<string, string>>(
  values: T,
  rules: Partial<Record<keyof T, (v: string) => string | null>>,
  send: () => Promise<void>,
  serverField: keyof T
) {
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found: FieldError[] = [];
    for (const [field, rule] of Object.entries(rules) as [string, (v: string) => string | null][]) {
      const msg = rule(values[field] ?? "");
      if (msg) found.push({ field, message: msg });
    }
    setErrors(found);
    if (found.length) return;

    setBusy(true);
    try {
      await send();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Check your connection and try again.";
      setErrors([{ field: String(serverField), message }]);
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (field: keyof T) => errors.find((e) => e.field === field)?.message;
  return { errors, busy, onSubmit, errorFor };
}
