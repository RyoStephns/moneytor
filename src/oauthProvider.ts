import crypto from "node:crypto";
import type { Response } from "express";
import type mysql from "mysql2/promise";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthError, newToken, sha256 } from "./auth.js";
import { pool } from "./repository.js";

const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_DAYS = 30;
const CODE_TTL_MIN = 5;
const REQUEST_TTL_MIN = 15;

type Db = mysql.Pool | mysql.PoolConnection;
type Row = mysql.RowDataPacket;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// What the consent screen shows next to the redirect host, since anyone can register a client.
// Gemini custom apps come back through Google's relay with a per-user path (community-reported,
// not in Google's docs), so only that path prefix on that exact host counts.
export function redirectKind(uri: string): "claude" | "gemini" | "local" | "other" {
  const u = new URL(uri);
  if (u.href === "https://claude.ai/api/mcp/auth_callback") return "claude";
  if (u.protocol === "https:" && u.host === "oauth-redirect.googleusercontent.com" && u.pathname.startsWith("/r/user_bound_custom-mcp")) return "gemini";
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return "local";
  return "other";
}

// Trailing slash and fragment don't make a different resource; people paste URLs both ways.
function sameResource(a: string | URL | null | undefined, b: string | URL): boolean {
  if (!a) return false;
  const norm = (v: string | URL) => String(v).split("#")[0].replace(/\/$/, "");
  return norm(a) === norm(b);
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.href;
}

async function revokeFamily(db: Db, familyId: string) {
  await db.execute(`UPDATE oauth_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE family_id = ? AND revoked_at IS NULL`, [familyId]);
}

export class MysqlOAuthProvider implements OAuthServerProvider {
  readonly resource: URL;
  readonly consentPath: string;

  constructor(resource: URL, consentPath = "/oauth/consent") {
    this.resource = resource;
    this.consentPath = consentPath;
  }

  readonly clientsStore: OAuthRegisteredClientsStore = {
    async getClient(clientId) {
      const [rows] = await pool.execute<Row[]>(`SELECT client_info FROM oauth_clients WHERE client_id = ?`, [clientId]);
      return rows[0]?.client_info as OAuthClientInformationFull | undefined;
    },
    // Every client is registered public (RFC 7591 §3.2.1 lets the server substitute the method).
    // The SDK's token endpoint only reads secrets from the body, so a client_secret_basic client
    // such as Gemini could never authenticate; PKCE is mandatory, and no secret is ever stored.
    async registerClient(info) {
      const { client_secret: _secret, client_secret_expires_at: _expiry, ...rest } = info as OAuthClientInformationFull;
      const full = { ...rest, token_endpoint_auth_method: "none" } as OAuthClientInformationFull;
      await pool.execute(`INSERT INTO oauth_clients (client_id, client_info) VALUES (?, ?)`, [full.client_id, JSON.stringify(full)]);
      return full;
    },
  };

  // The browser is sent to the consent screen; the code is minted there after the user says yes.
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && !sameResource(params.resource, this.resource)) {
      throw new InvalidTargetError(`This server only issues tokens for ${this.resource.href}`);
    }
    const id = crypto.randomUUID();
    await pool.execute(
      `
        INSERT INTO oauth_auth_requests (id, client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))
      `,
      [
        id, client.client_id, params.redirectUri, params.codeChallenge, params.state ?? null,
        params.scopes?.join(" ") || null, params.resource?.href ?? null, REQUEST_TTL_MIN,
      ]
    );
    res.redirect(302, `${this.consentPath}?request=${id}`);
  }

  async getAuthRequest(id: string) {
    const [rows] = await pool.execute<Row[]>(
      `
        SELECT r.redirect_uri, r.scopes, c.client_info
        FROM oauth_auth_requests r JOIN oauth_clients c ON c.client_id = r.client_id
        WHERE r.id = ? AND r.expires_at > UTC_TIMESTAMP(3)
      `,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      client_name: (row.client_info.client_name as string | undefined) ?? "Unnamed app",
      redirect_host: new URL(row.redirect_uri).host,
      redirect_kind: redirectKind(row.redirect_uri),
      scopes: row.scopes ? String(row.scopes).split(" ") : [],
    };
  }

  // Both resolve the pending request exactly once and hand back where to send the browser.
  async approveAuthRequest(id: string, userId: number): Promise<string> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const req = await this.takeRequest(conn, id);
      const code = newToken();
      await conn.execute(
        `
          INSERT INTO oauth_auth_codes (code_hash, family_id, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))
        `,
        [
          sha256(code), crypto.randomUUID(), req.client_id, userId, req.code_challenge, req.redirect_uri,
          req.scopes, req.resource ?? this.resource.href, CODE_TTL_MIN,
        ]
      );
      await conn.commit();
      return withParams(req.redirect_uri, { code, state: req.state ?? undefined });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async denyAuthRequest(id: string): Promise<string> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const req = await this.takeRequest(conn, id);
      await conn.commit();
      return withParams(req.redirect_uri, { error: "access_denied", state: req.state ?? undefined });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  private async takeRequest(conn: mysql.PoolConnection, id: string): Promise<Row> {
    const [rows] = await conn.execute<Row[]>(
      `SELECT * FROM oauth_auth_requests WHERE id = ? AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new AuthError("This authorization request expired. Start the connection again from your app.", 410);
    await conn.execute(`DELETE FROM oauth_auth_requests WHERE id = ?`, [id]);
    return rows[0];
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const [rows] = await pool.execute<Row[]>(
      `SELECT code_challenge FROM oauth_auth_codes WHERE code_hash = ? AND client_id = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
      [sha256(code), client.client_id]
    );
    if (rows.length === 0) throw new InvalidGrantError("Invalid or expired authorization code");
    return rows[0].code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<Row[]>(
        `SELECT *, expires_at <= UTC_TIMESTAMP(3) AS expired FROM oauth_auth_codes WHERE code_hash = ? AND client_id = ? FOR UPDATE`,
        [sha256(code), client.client_id]
      );
      const row = rows[0];
      if (!row) throw new InvalidGrantError("Invalid authorization code");
      if (row.used_at) {
        // a replayed code means it leaked: kill everything it already produced
        await revokeFamily(conn, row.family_id);
        await conn.commit();
        throw new InvalidGrantError("Authorization code already used");
      }
      if (row.expired) throw new InvalidGrantError("Authorization code expired");
      if (redirectUri !== row.redirect_uri) throw new InvalidGrantError("redirect_uri does not match the authorization request");
      if (resource && !sameResource(resource, row.resource)) throw new InvalidTargetError("resource does not match the authorization request");

      await conn.execute(`UPDATE oauth_auth_codes SET used_at = UTC_TIMESTAMP(3) WHERE code_hash = ?`, [row.code_hash]);
      const tokens = await this.issue(conn, row.family_id, client.client_id, Number(row.user_id), row.scopes, row.resource);
      await conn.commit();
      return tokens;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<Row[]>(
        `SELECT *, expires_at <= UTC_TIMESTAMP(3) AS expired FROM oauth_tokens WHERE token_hash = ? AND type = 'refresh' AND client_id = ? FOR UPDATE`,
        [sha256(refreshToken), client.client_id]
      );
      const row = rows[0];
      if (!row || row.revoked_at || row.expired) throw new InvalidGrantError("Invalid or expired refresh token");
      if (row.used_at) {
        await revokeFamily(conn, row.family_id);
        await conn.commit();
        throw new InvalidGrantError("Refresh token already used");
      }
      if (resource && !sameResource(resource, row.resource)) throw new InvalidTargetError("resource does not match the original grant");

      const granted: string[] = row.scopes ? String(row.scopes).split(" ") : [];
      const extra = scopes?.find((s) => !granted.includes(s));
      if (extra) throw new InvalidScopeError(`Scope "${extra}" was not part of the original grant`);

      await conn.execute(`UPDATE oauth_tokens SET used_at = UTC_TIMESTAMP(3) WHERE id = ?`, [row.id]);
      const tokens = await this.issue(conn, row.family_id, client.client_id, Number(row.user_id), scopes?.join(" ") || row.scopes, row.resource);
      await conn.commit();
      return tokens;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  private async issue(conn: mysql.PoolConnection, familyId: string, clientId: string, userId: number, scopes: string | null, resource: string): Promise<OAuthTokens> {
    const access = `at_${newToken()}`;
    const refresh = `rt_${newToken()}`;
    const sql = `
      INSERT INTO oauth_tokens (token_hash, type, family_id, client_id, user_id, scopes, resource, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))
    `;
    await conn.execute(sql, [sha256(access), "access", familyId, clientId, userId, scopes, resource, ACCESS_TTL_SEC]);
    await conn.execute(sql, [sha256(refresh), "refresh", familyId, clientId, userId, scopes, resource, REFRESH_TTL_DAYS * 86400]);
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      ...(scopes ? { scope: scopes } : {}),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const [rows] = await pool.execute<Row[]>(
      `
        SELECT t.client_id, t.user_id, t.scopes, t.resource, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), t.expires_at) AS ttl
        FROM oauth_tokens t JOIN users u ON u.id = t.user_id AND u.status = 'active'
        WHERE t.token_hash = ? AND t.type = 'access' AND t.revoked_at IS NULL AND t.expires_at > UTC_TIMESTAMP(3)
      `,
      [sha256(token)]
    );
    const row = rows[0];
    if (!row) throw new InvalidTokenError("Invalid or expired access token");
    // issued for another resource server: never ours to accept
    if (!sameResource(row.resource, this.resource)) throw new InvalidTokenError("Token was not issued for this server");
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes ? String(row.scopes).split(" ") : [],
      expiresAt: Math.floor(Date.now() / 1000) + Number(row.ttl),
      resource: new URL(row.resource),
      extra: { userId: Number(row.user_id) },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const [rows] = await pool.execute<Row[]>(`SELECT family_id FROM oauth_tokens WHERE token_hash = ? AND client_id = ?`, [
      sha256(request.token), client.client_id,
    ]);
    if (rows.length > 0) await revokeFamily(pool, rows[0].family_id);
  }
}

// DCR makes one client row per connection attempt, so these tables only grow without it.
export async function purgeExpiredAuth(): Promise<void> {
  await pool.execute(`DELETE FROM oauth_auth_requests WHERE expires_at < UTC_TIMESTAMP(3)`);
  await pool.execute(`DELETE FROM oauth_auth_codes WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)`);
  await pool.execute(`DELETE FROM oauth_tokens WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)`);
  await pool.execute(`DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP(3)`);
  await pool.execute(`
    DELETE FROM oauth_clients
    WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND client_id NOT IN (SELECT client_id FROM oauth_tokens)
      AND client_id NOT IN (SELECT client_id FROM oauth_auth_codes)
      AND client_id NOT IN (SELECT client_id FROM oauth_auth_requests)
  `);
}
