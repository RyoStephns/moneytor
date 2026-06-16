import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Static guard: every SQL statement in repository.ts that touches a tenant-owned
// table MUST filter by user_id. This is the cheap CI insurance against R3 — a
// future hand-written query that forgets `AND user_id = ?` and silently leaks
// another tenant's finance data.
//
// budget_group_categories is intentionally NOT user-scoped: it's always reached
// through budget_groups (which carries user_id), so its statements use the
// already-owned budget_group_id instead. See plan §0.5.

const repoPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/repository.ts"
);
const source = readFileSync(repoPath, "utf8");

// Pull out every backtick-delimited template literal that looks like SQL.
function extractSqlLiterals(src: string): string[] {
  const literals: string[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const body = m[1];
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(body)) {
      literals.push(body);
    }
  }
  return literals;
}

const SENSITIVE_TABLES = [
  "transactions",
  "categories",
  "pay_periods",
  "budget_groups",
  "budget_templates",
];

const sqlLiterals = extractSqlLiterals(source);

describe("repository tenant-isolation guard", () => {
  it("extracts SQL statements from repository.ts", () => {
    expect(sqlLiterals.length).toBeGreaterThan(20);
  });

  it("every statement touching a tenant table filters by user_id", () => {
    const offenders: string[] = [];

    for (const sql of sqlLiterals) {
      const touchesSensitive = SENSITIVE_TABLES.some((t) =>
        new RegExp(`\\b${t}\\b`).test(sql)
      );
      if (!touchesSensitive) continue;
      // A statement is scoped if it names user_id directly, OR if it
      // interpolates the WHERE fragment from buildWhere() — which always
      // emits `user_id = ?` as its first clause.
      const scoped = /user_id/.test(sql) || /\$\{whereSql\}/.test(sql);
      if (!scoped) {
        offenders.push(sql.trim().replace(/\s+/g, " ").slice(0, 120));
      }
    }

    expect(offenders, `SQL touching tenant tables without user_id:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("budget_group_categories statements use budget_group_id (scoped via parent)", () => {
    const bgcOnly = sqlLiterals.filter(
      (sql) =>
        /\bbudget_group_categories\b/.test(sql) &&
        !SENSITIVE_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(sql))
    );
    // Each such statement must key off budget_group_id, never run unscoped.
    for (const sql of bgcOnly) {
      expect(/budget_group_id/.test(sql)).toBe(true);
    }
  });

  it("every exported repository function takes userId as a parameter", () => {
    const exportRe = /export async function (\w+)\s*\(([^)]*)\)/g;
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = exportRe.exec(source)) !== null) {
      const [, name, params] = m;
      if (name === "closePool") continue; // pool lifecycle, no tenant data
      if (!/\buserId\b/.test(params)) offenders.push(name);
    }
    expect(offenders, `exported repo fns missing userId param: ${offenders.join(", ")}`).toEqual([]);
  });
});
