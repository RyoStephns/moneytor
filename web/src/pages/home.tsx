import type { SessionProps } from "../App";
import { onLink } from "../router";
import { CopyButton, usePageTitle } from "../ui";

export function AccountPage({ session }: SessionProps) {
  usePageTitle("Your account");
  const user = session.user!;
  const mcpUrl = `${location.origin}/mcp`;

  return (
    <div className="page">
      <header>
        <h1 className="display">Your account</h1>
        <p className="lede">Record and ask about your money by talking to Claude or Gemini. The <a href="/" onClick={onLink("/")}>dashboard</a> shows the same numbers they report.</p>
      </header>

      <section className="sheet stacked" aria-labelledby="connect-title">
        <h2 className="title" id="connect-title">Connect your assistant</h2>
        <p>Both Claude and Gemini connect with the same server address. Each person signs in with their own Moneytor account and only sees their own money.</p>
        <div className="codeline" style={{ marginTop: "var(--s4)" }}>
          <code>{mcpUrl}</code>
          <CopyButton text={mcpUrl} label="Copy address" />
        </div>

        <h3 className="subtitle">Claude</h3>
        <ol className="steps">
          <li><div>In Claude, open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</div></li>
          <li><div>Paste the server address above.</div></li>
          <li><div>Claude sends you back here to sign in and approve the connection.</div></li>
        </ol>

        <h3 className="subtitle">Gemini</h3>
        <ol className="steps">
          <li><div>On a computer, open <strong>gemini.google.com → Settings → Connected Apps</strong>. If it isn't there, open <strong>Personal Intelligence</strong> first.</div></li>
          <li><div>Under <strong>Custom apps</strong>, choose <strong>Add a custom app</strong> and paste the server address. Leave <strong>Advanced features</strong> empty; Gemini registers itself.</div></li>
          <li><div>Gemini sends you here to sign in and approve. Afterwards, type <code>@</code> in a Gemini prompt and pick Moneytor.</div></li>
        </ol>
        <p className="muted small" style={{ marginTop: "var(--s4)" }}>
          As of October 2026, Google offers custom apps only on personal Google accounts in the US, for people 18 and over, in English. If you don't see <strong>Custom apps</strong>, your Google account isn't eligible yet.
        </p>
      </section>

      <section className="sheet" aria-labelledby="account-title">
        <h2 className="title" id="account-title">Account</h2>
        <table className="record stack-sm">
          <tbody>
            <tr><th scope="row">Email</th><td>{user.email}</td></tr>
            <tr><th scope="row">Role</th><td>{user.is_owner ? "Owner" : "Member"}</td></tr>
          </tbody>
        </table>
        {user.is_owner && (
          <div className="after"><a href="/admin" onClick={onLink("/admin")}>Invite someone or see who has an account</a></div>
        )}
      </section>
    </div>
  );
}

export function NotFoundPage() {
  usePageTitle("Page not found");
  return (
    <div className="page">
      <header><h1 className="display">Page not found</h1></header>
      <div className="sheet">
        <p>There's nothing at this address. Check the link, or go back to your dashboard.</p>
        <div className="after"><a href="/" onClick={onLink("/")}>Go to your dashboard</a></div>
      </div>
    </div>
  );
}
