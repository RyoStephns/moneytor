import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { SessionProps } from "../App";
import { Button, CopyButton, fmtDate, Icon, usePageTitle } from "../ui";

type Invite = { id: number; status: "pending" | "used" | "revoked" | "expired"; expires_at: string; used_at: string | null; used_by: string | null; created_at: string };
type Person = { id: number; email: string; status: "active" | "disabled"; is_owner: boolean; created_at: string };

const LIFETIMES = [1, 3, 7, 14, 30];
const STATUS_LABEL: Record<Invite["status"], string> = { pending: "Waiting", used: "Used", revoked: "Revoked", expired: "Expired" };

export function AdminPage({ session }: SessionProps) {
  const [problem, setProblem] = useState<string | null>(null);
  usePageTitle("Invites & people", Boolean(problem));
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [issuing, setIssuing] = useState(false);
  const [fresh, setFresh] = useState<{ id: number; code: string; days: number } | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [inv, ppl] = await Promise.all([api<Invite[]>("/admin/invites"), api<Person[]>("/admin/users")]);
      setInvites(inv);
      setPeople(ppl);
    } catch (e) {
      setDenied(e instanceof ApiError && e.status === 403 ? "Only the owner of this Moneytor can manage invites." : "We couldn't load this page. Reload to try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    setIssuing(true);
    setProblem(null);
    try {
      const made = await api<{ id: number; code: string; valid_days: number }>("/admin/invites", { method: "POST", body: { days } });
      setFresh({ id: made.id, code: made.code, days: made.valid_days });
      await load();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The invite wasn't created. Try again.");
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (id: number) => {
    setRevoking(id);
    setProblem(null);
    try {
      await api(`/admin/invites/${id}/revoke`, { method: "POST" });
      if (fresh?.id === id) setFresh(null);
      await load();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That invite wasn't revoked. Try again.");
    } finally {
      setRevoking(null);
    }
  };

  if (denied) {
    return (
      <div className="page">
        <header><h1 className="display">Invites &amp; people</h1></header>
        <div className="sheet"><p>{denied}</p></div>
      </div>
    );
  }

  const link = fresh ? `${location.origin}/signup?code=${encodeURIComponent(fresh.code)}` : "";

  return (
    <div className="page wide">
      <header>
        <h1 className="display">Invites &amp; people</h1>
        <p className="lede">Moneytor is invite only. Each code works once, for one new account, until it expires.</p>
      </header>

      <section className="sheet stacked" aria-labelledby="invites-title">
        <div className="section-head">
          <h2 className="title" id="invites-title">Invites</h2>
        </div>

        <div className="issue">
          <div className="field">
            <label htmlFor="lifetime">Code stays valid for</label>
            <select id="lifetime" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {LIFETIMES.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
            </select>
          </div>
          <Button busy={issuing} disabled={issuing} seg={`${days} ${days === 1 ? "day" : "days"}`} onClick={issue}>
            {issuing ? "Creating…" : "Create invite"}
          </Button>
        </div>

        {problem && <p className="error" role="alert" style={{ marginTop: "var(--s4)" }}><i className="err-mark" aria-hidden="true" /><span><span className="visually-hidden">Error: </span>{problem}</span></p>}

        {fresh && (
          <div className="fresh-code" role="status">
            <p><strong>Copy this now.</strong> The code is shown only once. Send the link to the person you're inviting; it works for {fresh.days === 1 ? "1 day" : `${fresh.days} days`}.</p>
            <div className="codeline"><code>{fresh.code}</code><CopyButton text={fresh.code} label="Copy code" /></div>
            <div className="codeline"><span className="small muted" style={{ overflowWrap: "anywhere" }}>{link}</span><CopyButton text={link} label="Copy sign-up link" /></div>
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: "var(--s6)" }}>
          <table className="record cards-sm">
            <thead>
              <tr>
                <th scope="col" className="legend">Invite</th>
                <th scope="col" className="legend">Status</th>
                <th scope="col" className="legend">Expires</th>
                <th scope="col" className="legend">Used by</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {invites === null && [0, 1].map((i) => <tr key={i}><td colSpan={5}><div className="skeleton" /></td></tr>)}
              {invites?.length === 0 && <tr><td colSpan={5} className="empty plain">No invites yet. Create one above, then send the link to the person you're inviting.</td></tr>}
              {invites?.map((inv) => (
                <tr key={inv.id} className={fresh?.id === inv.id ? "key" : undefined}>
                  <td data-label="Invite">#{inv.id}</td>
                  <td data-label="Status"><span className={`status ${inv.status}`}><i aria-hidden="true" />{STATUS_LABEL[inv.status]}</span></td>
                  <td data-label="Expires" className="plain">{fmtDate(inv.expires_at)}</td>
                  <td data-label="Used by" className="plain">{inv.used_by ?? "—"}</td>
                  <td className="num">
                    {inv.status === "pending" && (
                      <Button variant="danger" busy={revoking === inv.id} disabled={revoking !== null} onClick={() => revoke(inv.id)} aria-label={`Revoke invite #${inv.id}`}>
                        {revoking === inv.id ? "Revoking…" : "Revoke"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sheet" aria-labelledby="people-title">
        <div className="section-head">
          <h2 className="title" id="people-title">People</h2>
          {people && <span className="muted small">{people.length} {people.length === 1 ? "account" : "accounts"}</span>}
        </div>
        <div className="table-wrap">
          <table className="record cards-sm">
            <thead>
              <tr>
                <th scope="col" className="legend">Email</th>
                <th scope="col" className="legend">Role</th>
                <th scope="col" className="legend">Status</th>
                <th scope="col" className="legend">Joined</th>
              </tr>
            </thead>
            <tbody>
              {people === null && [0, 1].map((i) => <tr key={i}><td colSpan={4}><div className="skeleton" /></td></tr>)}
              {people?.map((p) => (
                <tr key={p.id}>
                  <td data-label="Email"><span>{p.email}{p.id === session.user?.id && <span className="muted plain"> (you)</span>}</span></td>
                  <td data-label="Role" className="plain">{p.is_owner ? "Owner" : "Member"}</td>
                  <td data-label="Status" className="plain">{p.status === "active" ? <span className="status used"><i aria-hidden="true" />Active</span> : <span className="status revoked"><i aria-hidden="true" />Disabled</span>}</td>
                  <td data-label="Joined" className="plain">{fmtDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted small" style={{ marginTop: "var(--s5)", display: "flex", gap: "var(--s2)", alignItems: "center" }}>
        <Icon name="alert" size={16} /> Removing or disabling accounts isn't available yet.
      </p>
    </div>
  );
}
