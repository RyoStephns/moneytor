import { useCallback, useEffect, useState } from "react";
import { api, setCsrf, type Session } from "./api";
import { navigate, useLocation } from "./router";
import { Shell } from "./ui";
import { LoginPage, SetupPage, SignupPage } from "./pages/access";
import { ConsentPage } from "./pages/consent";
import { AdminPage } from "./pages/admin";
import { AccountPage, NotFoundPage } from "./pages/home";
import { DashboardPage } from "./pages/dashboard";

export type SessionProps = { session: Session; onSession: (s: Session) => void };

export function App() {
  const loc = useLocation();
  const [session, setSession] = useState<Session | null>(null);

  const refresh = useCallback(async () => {
    const s = await api<Session>("/auth/session");
    setCsrf(s.csrf);
    setSession(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSession = (s: Session) => {
    setCsrf(s.csrf);
    setSession(s);
  };

  const signOut = async () => {
    await api("/auth/logout", { method: "POST" });
    await refresh();
    navigate("/login");
  };

  if (!session) return <p className="visually-hidden" role="status">Loading</p>;

  const path = loc.pathname;
  const signedIn = Boolean(session.user);
  const props = { session, onSession };
  const next = encodeURIComponent(loc.pathname + loc.search);

  let page;
  if (path === "/setup") page = <SetupPage {...props} />;
  else if (path === "/login") page = <LoginPage {...props} next={loc.searchParams.get("next")} />;
  else if (path === "/signup") page = <SignupPage {...props} code={loc.searchParams.get("code") ?? ""} />;
  else if (path === "/oauth/consent") page = signedIn ? <ConsentPage {...props} requestId={loc.searchParams.get("request")} /> : <Redirect to={`/login?next=${next}`} />;
  else if (path === "/admin") page = signedIn ? <AdminPage {...props} /> : <Redirect to={`/login?next=${next}`} />;
  else if (path === "/account") page = signedIn ? <AccountPage {...props} /> : <Redirect to={`/login?next=${next}`} />;
  else if (path === "/") page = signedIn ? <DashboardPage /> : <Redirect to={session.setup === "done" ? "/login" : "/setup"} />;
  else page = <NotFoundPage />;

  return (
    <Shell session={session} path={path} onSignOut={signOut}>
      {page}
    </Shell>
  );
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
