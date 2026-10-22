import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import type { SessionProps } from "../App";
import { checks, useSubmit } from "../form";
import { navigate, onLink, safeNext } from "../router";
import { Button, ErrorSummary, Field, usePageTitle } from "../ui";

type Signed = Pick<Session, "user" | "csrf">;

export function LoginPage({ session, onSession, next }: SessionProps & { next: string | null }) {
  const target = safeNext(next);
  const [form, setForm] = useState({ email: "", password: "" });
  const { errors, busy, onSubmit, errorFor } = useSubmit(
    form,
    { email: checks.email, password: checks.password },
    async () => {
      const s = await api<Signed>("/auth/login", { method: "POST", body: form });
      onSession({ ...session, ...s });
      navigate(target, true);
    },
    "email"
  );
  usePageTitle("Sign in", errors.length > 0);

  useEffect(() => {
    if (session.user) navigate(target, true);
  }, [session.user, target]);

  const toConsent = target.startsWith("/oauth/consent");

  return (
    <div className="page">
      <header>
        <h1 className="display">Sign in</h1>
        <p className="lede">{toConsent ? "An app is asking to connect to your Moneytor. Sign in first, then you'll see exactly what it wants." : "Use the email and password you set up for Moneytor."}</p>
      </header>
      <ErrorSummary errors={errors} />
      <form className="sheet stacked form" noValidate onSubmit={onSubmit}>
        <Field id="email" label="Email address" type="email" autoComplete="email" spellCheck={false} value={form.email} error={errorFor("email")} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field id="password" label="Password" secret autoComplete="current-password" value={form.password} error={errorFor("password")} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="actions">
          <Button type="submit" busy={busy} grow seg={toConsent ? "Then review access" : undefined} segIcon={toConsent ? undefined : "arrow"}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
        <div className="after">
          <p>Got an invite code? <a href="/signup" onClick={onLink("/signup")}>Create your account</a>.</p>
        </div>
      </form>
    </div>
  );
}

export function SignupPage({ session, onSession, code }: SessionProps & { code: string }) {
  const [form, setForm] = useState({ code, email: "", password: "" });
  const { errors, busy, onSubmit, errorFor } = useSubmit(
    form,
    { code: checks.required("Enter the invite code you were given"), email: checks.email, password: checks.newPassword },
    async () => {
      const s = await api<Signed>("/auth/signup", { method: "POST", body: form });
      onSession({ ...session, ...s });
      navigate("/", true);
    },
    "code"
  );
  usePageTitle("Create account", errors.length > 0);

  if (session.user) {
    return (
      <div className="page">
        <header><h1 className="display">You're signed in</h1></header>
        <div className="sheet">
          <p>You're already signed in as <strong>{session.user.email}</strong>. To create a different account, sign out first.</p>
          <div className="after"><a href="/" onClick={onLink("/")}>Go to your account</a></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header>
        <h1 className="display">Create your account</h1>
        <p className="lede">Moneytor is invite only. Enter the code you were given, then choose how you'll sign in.</p>
      </header>
      <ErrorSummary errors={errors} />
      <form className="sheet stacked form" noValidate onSubmit={onSubmit}>
        <Field id="code" label="Invite code" className="mono" autoComplete="off" spellCheck={false} value={form.code} error={errorFor("code")} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <Field id="email" label="Email address" type="email" autoComplete="email" spellCheck={false} value={form.email} error={errorFor("email")} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field id="password" label="Create a password" hint="At least 8 characters. A long phrase is easier to remember than a short jumble." secret autoComplete="new-password" value={form.password} error={errorFor("password")} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="actions">
          <Button type="submit" busy={busy} grow seg="Uses the invite">
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </div>
        <div className="after">
          <p>Already have an account? <a href="/login" onClick={onLink("/login")}>Sign in</a>.</p>
        </div>
      </form>
    </div>
  );
}

export function SetupPage({ session, onSession }: SessionProps) {
  const [form, setForm] = useState({ token: "", email: "", password: "" });
  const { errors, busy, onSubmit, errorFor } = useSubmit(
    form,
    { token: checks.required("Enter the setup token from the server's .env file"), email: checks.email, password: checks.newPassword },
    async () => {
      const s = await api<Signed>("/auth/setup", { method: "POST", body: form });
      onSession({ ...session, ...s, setup: "done" });
      navigate("/", true);
    },
    "token"
  );
  usePageTitle("Set up Moneytor", errors.length > 0);

  if (session.setup === "done") {
    return (
      <div className="page">
        <header><h1 className="display">Already set up</h1></header>
        <div className="sheet">
          <p>This Moneytor already has an owner. Sign in, or ask the owner for an invite.</p>
          <div className="after"><a href="/login" onClick={onLink("/login")}>Sign in</a></div>
        </div>
      </div>
    );
  }

  if (session.setup === "unavailable") {
    return (
      <div className="page">
        <header>
          <h1 className="display">Setup is switched off</h1>
          <p className="lede">This Moneytor has no owner yet, and setup only opens when the server has a setup token.</p>
        </header>
        <div className="sheet">
          <ol className="steps">
            <li><div>Add <code>SETUP_TOKEN=</code> followed by a long random value to the server's <code>.env</code> file.</div></li>
            <li><div>Restart the server.</div></li>
            <li><div>Reload this page and enter that token.</div></li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header>
        <h1 className="display">Set up Moneytor</h1>
        <p className="lede">This instance has no owner yet. The person who runs the server claims it with the setup token from its <code>.env</code> file. Anything already recorded becomes yours.</p>
      </header>
      <ErrorSummary errors={errors} />
      <form className="sheet stacked form" noValidate onSubmit={onSubmit}>
        <Field id="token" label="Setup token" hint="The value of SETUP_TOKEN on the server. It's only needed once." secret className="mono" autoComplete="off" spellCheck={false} value={form.token} error={errorFor("token")} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        <Field id="email" label="Your email address" type="email" autoComplete="email" spellCheck={false} value={form.email} error={errorFor("email")} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field id="password" label="Create a password" hint="At least 8 characters." secret autoComplete="new-password" value={form.password} error={errorFor("password")} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="actions">
          <Button type="submit" busy={busy} grow seg="As owner">
            {busy ? "Claiming…" : "Claim this Moneytor"}
          </Button>
        </div>
      </form>
    </div>
  );
}
