import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { onLink } from "./router";
import type { Session } from "./api";

const PATHS = {
  arrow: "M4 12h15M13 6l6 6-6 6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2",
  alert: "M12 3l10 18H2L12 3zM12 10v5M12 18v.01",
  check: "M4 12.5l5 5L20 6.5",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function usePageTitle(title: string, hasError = false) {
  useEffect(() => {
    document.title = `${hasError ? "Error: " : ""}${title} · Moneytor`;
  }, [title, hasError]);
}

const RAMP = Array.from({ length: 11 }, (_, i) => `var(--zone-${i})`);

export function Shell({ session, path, onSignOut, children }: { session: Session; path: string; onSignOut: () => void; children: ReactNode }) {
  const user = session.user;
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="/" onClick={onLink("/")}>
          <span className="ramp" aria-hidden="true">{RAMP.map((c) => <i key={c} style={{ background: c }} />)}</span>
          Moneytor
        </a>
        {user && (
          <nav aria-label="Account">
            <span className="who">{user.email}</span>
            <a href="/" onClick={onLink("/")} aria-current={path === "/" ? "page" : undefined}>Dashboard</a>
            <a href="/account" onClick={onLink("/account")} aria-current={path === "/account" ? "page" : undefined}>Account</a>
            {user.is_owner && <a href="/admin" onClick={onLink("/admin")} aria-current={path === "/admin" ? "page" : undefined}>Invites &amp; people</a>}
            <button type="button" className="linkish" onClick={onSignOut}>Sign out</button>
          </nav>
        )}
      </header>
      <main id="main">{children}</main>
    </>
  );
}

export type FieldError = { field: string; message: string };

// GOV.UK pattern: a summary that takes focus and links to each field, plus the same message inline.
export function ErrorSummary({ errors }: { errors: FieldError[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) ref.current?.focus();
  }, [errors]);
  if (!errors.length) return null;
  return (
    <div className="summary" role="alert" tabIndex={-1} ref={ref} aria-labelledby="summary-title">
      <h2 id="summary-title">There is a problem</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.field + e.message}>
            <a href={`#${e.field}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(e.field)?.focus(); }}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string; error?: string; secret?: boolean };

export function Field({ id, label, hint, error, secret, className, ...input }: FieldProps) {
  const [shown, setShown] = useState(false);
  const hintId = useId();
  const errId = useId();
  const described = [hint && hintId, error && errId].filter(Boolean).join(" ") || undefined;
  const el = (
    <input
      {...input}
      id={id}
      name={id}
      type={secret ? (shown ? "text" : "password") : input.type ?? "text"}
      className={`input ${className ?? ""}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={described}
    />
  );
  return (
    <div className={`field${error ? " invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint" id={hintId}>{hint}</p>}
      {error && <p className="error" id={errId}><i className="err-mark" aria-hidden="true" /><span><span className="visually-hidden">Error: </span>{error}</span></p>}
      {secret ? (
        <div className="input-row">
          {el}
          <button type="button" className="reveal" aria-controls={id} aria-pressed={shown} onClick={() => setShown(!shown)}>
            <Icon name={shown ? "eyeOff" : "eye"} size={16} />
            {shown ? "Hide" : "Show"}
          </button>
        </div>
      ) : el}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  seg?: string;
  segIcon?: keyof typeof PATHS;
  busy?: boolean;
  grow?: boolean;
};

// The primary's segment states what the click will do (where access goes, how long an invite lives).
export function Button({ variant = "primary", seg, segIcon, busy, grow, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={`btn btn-${variant}${grow ? " grow" : ""}${seg ? " text-seg" : ""} ${className ?? ""}`}
    >
      <span>{children}</span>
      {(seg || segIcon) && <span className="seg">{segIcon && <Icon name={segIcon} size={16} />}{seg}</span>}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="quiet"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      <Icon name={done ? "check" : "copy"} size={16} />
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </Button>
  );
}

export function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
