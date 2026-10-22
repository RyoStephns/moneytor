import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { SessionProps } from "../App";
import { onLink } from "../router";
import { Button, Icon, usePageTitle } from "../ui";

type AuthRequest = {
  client_name: string;
  redirect_host: string;
  redirect_kind: "claude" | "gemini" | "local" | "other";
  scopes: string[];
};

const RETURN_NOTE: Record<AuthRequest["redirect_kind"], string> = {
  claude: "Claude's own address.",
  gemini: "Google's sign-in relay for Gemini custom apps.",
  local: "An app running on this computer, such as Claude Code. Only approve it if you started it here.",
  other: "Moneytor doesn't recognize this address.",
};

export function ConsentPage({ session, requestId }: SessionProps & { requestId: string | null }) {
  const [req, setReq] = useState<AuthRequest | null>(null);
  const [failure, setFailure] = useState<string | null>(requestId ? null : "This link is missing its request. Go back to your app and start the connection again.");
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  usePageTitle("Access request", Boolean(failure));

  useEffect(() => {
    if (!requestId) return;
    api<AuthRequest>(`/oauth/requests/${encodeURIComponent(requestId)}`)
      .then(setReq)
      .catch((e) => setFailure(e instanceof ApiError ? e.message : "We couldn't load this request. Check your connection and reload."));
  }, [requestId]);

  const decide = async (choice: "allow" | "deny") => {
    setBusy(choice);
    try {
      const { redirect } = await api<{ redirect: string }>(`/oauth/requests/${encodeURIComponent(requestId!)}/${choice === "allow" ? "approve" : "deny"}`, { method: "POST" });
      setLeaving(choice === "allow" ? `Access approved. Taking you back to ${req!.redirect_host}…` : `Request denied. Taking you back to ${req!.redirect_host}…`);
      window.location.assign(redirect);
    } catch (e) {
      setBusy(null);
      // an expired or already-used request can't be retried, so drop to the "unavailable" view
      if (e instanceof ApiError && e.status === 410) setReq(null);
      setFailure(e instanceof ApiError ? e.message : "That didn't go through. Check your connection and try again.");
    }
  };

  if (failure && !req) {
    return (
      <div className="page">
        <header><h1 className="display">Request unavailable</h1></header>
        <div className="sheet">
          <p>{failure}</p>
          <div className="after"><a href="/" onClick={onLink("/")}>Go to your dashboard</a></div>
        </div>
      </div>
    );
  }

  const unknown = req?.redirect_kind === "other";

  return (
    <div className="page">
      <header>
        <h1 className="display">{req ? `${req.client_name} wants access to your Moneytor` : "Access request"}</h1>
        <p className="lede">Approve only if you started this connection yourself, just now.</p>
      </header>

      <section className="sheet stacked" aria-labelledby="record-title" aria-busy={!req}>
        <h2 className="title record-title" id="record-title">Access request</h2>
        <table className="record stack-sm">
          <tbody>
            <tr>
              <th scope="row">Application</th>
              <td>{req ? req.client_name : <div className="skeleton" />}</td>
            </tr>
            <tr>
              <th scope="row">Acts as</th>
              <td>{session.user!.email}</td>
            </tr>
            <tr className={unknown ? "key conflict" : "key"}>
              <th scope="row">Returns to</th>
              <td>
                {req ? <>{req.redirect_host}<span className="note">{RETURN_NOTE[req.redirect_kind]}</span></> : <div className="skeleton" />}
              </td>
            </tr>
            <tr>
              <th scope="row">Can see</th>
              <td className="plain">Your accounts and balances, transactions, budgets, and who owes you</td>
            </tr>
            <tr>
              <th scope="row">Can change</th>
              <td className="plain">Record, edit and delete entries, transfers and receivables</td>
            </tr>
            <tr>
              <th scope="row">Can't</th>
              <td className="plain">See your password or change how you sign in</td>
            </tr>
          </tbody>
        </table>

        {unknown && (
          <div className="notice warn" role="note" style={{ marginTop: "var(--s5)" }}>
            <Icon name="alert" size={22} />
            <div>
              <strong>Check this address before you approve</strong>
              Claude returns to claude.ai and Gemini to oauth-redirect.googleusercontent.com. An unfamiliar address could be someone trying to get into your account. When in doubt, deny.
            </div>
          </div>
        )}

        {failure && <p className="error" role="alert" style={{ marginTop: "var(--s5)" }}><i className="err-mark" aria-hidden="true" /><span><span className="visually-hidden">Error: </span>{failure}</span></p>}
        {leaving && <p role="status" style={{ marginTop: "var(--s5)", fontWeight: 600 }}>{leaving}</p>}

        <div className="actions" style={{ marginTop: "var(--s6)" }}>
          <Button variant="secondary" disabled={!req || busy !== null} busy={busy === "deny"} onClick={() => decide("deny")}>
            {busy === "deny" ? "Denying…" : "Deny"}
          </Button>
          <Button grow disabled={!req || busy !== null} busy={busy === "allow"} seg={req ? req.redirect_host : "…"} segIcon="arrow" onClick={() => decide("allow")}>
            {busy === "allow" ? "Approving…" : "Allow access"}
          </Button>
        </div>
        <div className="after muted">
          <p>The request stays open for 15 minutes. You can stop a connected app later by removing it in that app.</p>
        </div>
      </section>
    </div>
  );
}
