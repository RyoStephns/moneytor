import crypto from "node:crypto";
import { promisify } from "node:util";
import type mysql from "mysql2/promise";
import { config } from "./config.js";
import { pool } from "./repository.js";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: crypto.ScryptOptions
) => Promise<Buffer>;

// OWASP's scrypt floor (N=2^15, r=8, p=3). The params travel with the hash so they can go up later.
const COST = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD = 8;

export type AuthUser = { id: number; email: string; is_owner: boolean };

// Failures the person on the other end should read. Anything else is a bug and stays a 500.
export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const normEmail = (email: string) => email.trim().toLowerCase();

function assertPassword(password: string) {
  if (password.length < MIN_PASSWORD) throw new AuthError(`Password must be at least ${MIN_PASSWORD} characters.`);
}

function isDuplicateEmail(e: unknown): boolean {
  return (e as { errno?: number }).errno === 1062;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt") return false;
  const want = Buffer.from(key, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), want.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: COST.maxmem,
  });
  return crypto.timingSafeEqual(got, want);
}

// Unknown emails still pay for one scrypt run, otherwise response time tells who has an account.
let dummyHash: Promise<string> | undefined;

export async function loginWithPassword(email: string, password: string): Promise<AuthUser> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id, email, password_hash, is_owner FROM users WHERE email = ? AND status = 'active' LIMIT 1`,
    [normEmail(email)]
  );
  const row = rows[0];
  dummyHash ??= hashPassword("no-such-user-password");
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash));
  if (!row?.password_hash || !ok) throw new AuthError("Invalid email or password.", 401);
  return { id: Number(row.id), email: row.email, is_owner: row.is_owner === 1 };
}

async function requireOwner(userId: number) {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM users WHERE id = ? AND is_owner = 1 AND status = 'active' LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) throw new AuthError("Owner access required.", 403);
}

export async function createInvite(ownerId: number, days = 7) {
  await requireOwner(ownerId);
  const code = `inv_${newToken(18)}`;
  const [res] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO invite_codes (code_hash, created_by, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))`,
    [sha256(code), ownerId, days]
  );
  // the plain code exists only in this return value, the table keeps the hash
  return { id: res.insertId, code, valid_days: days };
}

export async function revokeInvite(ownerId: number, id: number): Promise<boolean> {
  await requireOwner(ownerId);
  const [res] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE invite_codes SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND created_by = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [id, ownerId]
  );
  return res.affectedRows > 0;
}

export async function listInvites(ownerId: number) {
  await requireOwner(ownerId);
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT i.id, i.expires_at, i.used_at, i.revoked_at, i.created_at, u.email AS used_by,
        CASE
          WHEN i.used_at IS NOT NULL THEN 'used'
          WHEN i.revoked_at IS NOT NULL THEN 'revoked'
          WHEN i.expires_at <= UTC_TIMESTAMP(3) THEN 'expired'
          ELSE 'pending'
        END AS status
      FROM invite_codes i
      LEFT JOIN users u ON u.id = i.used_by_user_id
      WHERE i.created_by = ?
      ORDER BY i.id DESC
    `,
    [ownerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    status: r.status as "pending" | "used" | "revoked" | "expired",
    expires_at: r.expires_at,
    used_at: r.used_at,
    used_by: r.used_by as string | null,
    created_at: r.created_at,
  }));
}

export async function listUsers(ownerId: number) {
  await requireOwner(ownerId);
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id, email, display_name, status, is_owner, created_at FROM users ORDER BY id ASC`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    display_name: r.display_name as string | null,
    status: r.status as "active" | "disabled",
    is_owner: r.is_owner === 1,
    created_at: r.created_at,
  }));
}

export async function signUpWithInvite(input: { email: string; password: string; code: string }): Promise<AuthUser> {
  assertPassword(input.password);
  const email = normEmail(input.email);
  const hash = await hashPassword(input.password);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [invite] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id FROM invite_codes WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE`,
      [sha256(input.code.trim())]
    );
    if (invite.length === 0) throw new AuthError("Invalid or expired invite code.");

    let userId: number;
    try {
      const [res] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (email, password_hash, status) VALUES (?, ?, 'active')`,
        [email, hash]
      );
      userId = res.insertId;
    } catch (e) {
      if (isDuplicateEmail(e)) throw new AuthError("An account with this email already exists.");
      throw e;
    }
    await conn.execute(`UPDATE invite_codes SET used_by_user_id = ?, used_at = UTC_TIMESTAMP(3) WHERE id = ?`, [userId, invite[0].id]);
    await conn.commit();
    return { id: userId, email, is_owner: false };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Migration 007 always seeds the owner row (id 1), so a fresh fork and the existing
// prod instance take the same path: fill in that row's email and password.
export async function setupOwner(input: { token: string; email: string; password: string }): Promise<AuthUser> {
  const expected = config.setupToken;
  if (!expected) throw new AuthError("Setup is disabled. Set SETUP_TOKEN in .env to enable it.");
  if (!crypto.timingSafeEqual(Buffer.from(sha256(input.token)), Buffer.from(sha256(expected)))) {
    throw new AuthError("Invalid setup token.");
  }
  assertPassword(input.password);
  const email = normEmail(input.email);
  const hash = await hashPassword(input.password);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [owners] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, password_hash FROM users WHERE is_owner = 1 ORDER BY id ASC LIMIT 1 FOR UPDATE`
    );
    if (owners.length === 0) throw new AuthError("Owner account not found. Run npm run migrate first.");
    if (owners[0].password_hash) throw new AuthError("Setup is already complete.");

    try {
      await conn.execute(`UPDATE users SET email = ?, password_hash = ? WHERE id = ?`, [email, hash, owners[0].id]);
    } catch (e) {
      if (isDuplicateEmail(e)) throw new AuthError("An account with this email already exists.");
      throw e;
    }
    await conn.commit();
    return { id: Number(owners[0].id), email, is_owner: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function setupState(): Promise<"needed" | "unavailable" | "done"> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT password_hash IS NULL AS open FROM users WHERE is_owner = 1 ORDER BY id ASC LIMIT 1`
  );
  if (!rows[0]?.open) return "done";
  return config.setupToken ? "needed" : "unavailable";
}
