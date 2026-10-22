import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type mysql from "mysql2/promise";
import { AuthError, newToken, sha256, type AuthUser } from "./auth.js";
import { pool } from "./repository.js";

export const SESSION_COOKIE = "moneytor_session";
const SESSION_DAYS = 30;

export type WebSession = { sid: string; csrf: string; user: AuthUser };

declare module "express-serve-static-core" {
  interface Request {
    session?: WebSession;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function startSession(res: Response, user: AuthUser): Promise<WebSession> {
  const sid = newToken();
  const csrf = newToken();
  await pool.execute(
    `
      INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at, last_used_at)
      VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY), UTC_TIMESTAMP(3))
    `,
    [sha256(sid), user.id, csrf, SESSION_DAYS]
  );
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
  return { sid, csrf, user };
}

export async function endSession(req: Request, res: Response): Promise<void> {
  if (req.session) await pool.execute(`DELETE FROM sessions WHERE id_hash = ?`, [sha256(req.session.sid)]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const sid = readCookie(req, SESSION_COOKIE);
  if (sid) {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `
        SELECT s.csrf_token, u.id, u.email, u.is_owner
        FROM sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
        WHERE s.id_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)
      `,
      [sha256(sid)]
    );
    const row = rows[0];
    if (row) {
      req.session = { sid, csrf: row.csrf_token, user: { id: Number(row.id), email: row.email, is_owner: row.is_owner === 1 } };
    }
  }
  next();
}

export function requireSession(req: Request): WebSession {
  if (!req.session) throw new AuthError("Sign in first.", 401);
  return req.session;
}

// Every state-changing call from a signed-in page carries the token it got from /api/auth/session.
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  const s = requireSession(req);
  const sent = Buffer.from(String(req.get("x-csrf-token") ?? ""));
  const want = Buffer.from(s.csrf);
  if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) {
    throw new AuthError("Your session token is missing or stale. Reload the page.", 403);
  }
  next();
}
