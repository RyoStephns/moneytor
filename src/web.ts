import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  AuthError,
  createInvite,
  listInvites,
  listUsers,
  loginWithPassword,
  revokeInvite,
  setupOwner,
  setupState,
  signUpWithInvite,
} from "./auth.js";
import { config } from "./config.js";
import type { MysqlOAuthProvider } from "./oauthProvider.js";
import { endSession, loadSession, requireCsrf, requireSession, startSession } from "./session.js";

const email = z.string().trim().max(255).pipe(z.email({ error: "Enter a valid email address." }));
const password = z.string().min(1, { error: "Enter your password." }).max(200);
const loginBody = z.object({ email, password });
const signupBody = z.object({ email, password, code: z.string().trim().min(1, { error: "Enter your invite code." }).max(100) });
const setupBody = z.object({ token: z.string().min(1, { error: "Enter the setup token." }).max(500), email, password });
const inviteBody = z.object({ days: z.number().int().min(1).max(30).default(7) });

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 5;

const sessionJson = (s: { csrf: string; user: { id: number; email: string; is_owner: boolean } }) => ({ user: s.user, csrf: s.csrf });

export function createWebApi(provider: MysqlOAuthProvider) {
  const api = express.Router();

  // Per-account lockout on top of the per-IP limit, so one address can't be guessed from many IPs.
  // In memory on purpose: one process, and a restart only gives an attacker a fresh 5 tries.
  const failures = new Map<string, { n: number; since: number }>();
  const lockedOut = (key: string) => {
    const f = failures.get(key);
    if (f && Date.now() - f.since > FAIL_WINDOW_MS) failures.delete(key);
    return (failures.get(key)?.n ?? 0) >= FAIL_LIMIT;
  };
  const noteFailure = (key: string) => {
    const f = failures.get(key);
    if (!f || Date.now() - f.since > FAIL_WINDOW_MS) failures.set(key, { n: 1, since: Date.now() });
    else f.n++;
  };

  const authLimiter = rateLimit({
    windowMs: FAIL_WINDOW_MS,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts from this network. Try again in 15 minutes." },
  });
  api.use(express.json({ limit: "64kb" }));
  api.use(loadSession);

  // A cross-site form can only post urlencoded or multipart without a CORS preflight,
  // which this API never answers. Insisting on JSON closes login CSRF for the signed-out routes.
  api.use((req, _res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && !req.is("application/json")) {
      throw new AuthError("Expected a JSON body.", 415);
    }
    next();
  });

  api.get("/auth/session", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ...(req.session ? sessionJson(req.session) : { user: null, csrf: null }), setup: await setupState() });
  });

  api.post("/auth/login", authLimiter, async (req, res) => {
    const body = loginBody.parse(req.body);
    const key = body.email.toLowerCase();
    if (lockedOut(key)) throw new AuthError("Too many failed attempts for this account. Try again in 15 minutes.", 429);
    try {
      const user = await loginWithPassword(body.email, body.password);
      failures.delete(key);
      res.json(sessionJson(await startSession(res, user)));
    } catch (e) {
      if (e instanceof AuthError) noteFailure(key);
      throw e;
    }
  });

  api.post("/auth/signup", authLimiter, async (req, res) => {
    const user = await signUpWithInvite(signupBody.parse(req.body));
    res.status(201).json(sessionJson(await startSession(res, user)));
  });

  if (config.setupToken) {
    api.post("/auth/setup", authLimiter, async (req, res) => {
      const user = await setupOwner(setupBody.parse(req.body));
      res.status(201).json(sessionJson(await startSession(res, user)));
    });
  }

  api.post("/auth/logout", requireCsrf, async (req, res) => {
    await endSession(req, res);
    res.status(204).end();
  });

  api.get("/admin/users", async (req, res) => {
    res.json(await listUsers(requireSession(req).user.id));
  });

  api.get("/admin/invites", async (req, res) => {
    res.json(await listInvites(requireSession(req).user.id));
  });

  api.post("/admin/invites", requireCsrf, async (req, res) => {
    const { days } = inviteBody.parse(req.body ?? {});
    res.status(201).json(await createInvite(requireSession(req).user.id, days));
  });

  api.post("/admin/invites/:id/revoke", requireCsrf, async (req, res) => {
    const ok = await revokeInvite(requireSession(req).user.id, Number(req.params.id));
    if (!ok) throw new AuthError("That invite is already used, revoked, or doesn't exist.", 404);
    res.status(204).end();
  });

  api.get("/oauth/requests/:id", async (req, res) => {
    requireSession(req);
    const found = await provider.getAuthRequest(String(req.params.id));
    if (!found) throw new AuthError("This authorization request expired. Start the connection again from your app.", 410);
    res.json(found);
  });

  api.post("/oauth/requests/:id/approve", requireCsrf, async (req, res) => {
    res.json({ redirect: await provider.approveAuthRequest(String(req.params.id), requireSession(req).user.id) });
  });

  api.post("/oauth/requests/:id/deny", requireCsrf, async (req, res) => {
    requireSession(req);
    res.json({ redirect: await provider.denyAuthRequest(String(req.params.id)) });
  });

  api.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuthError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request." });
    if ((err as { type?: string }).type === "entity.parse.failed") return void res.status(400).json({ error: "Malformed JSON." });
    console.error("API request failed", err);
    res.status(500).json({ error: "Something went wrong. Try again." });
  });

  return api;
}
