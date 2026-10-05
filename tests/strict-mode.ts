// The repo pool inherits the server's sql_mode, which is empty on this dev box
// but strict on a stock MySQL 8. Call this before importing the repository so a
// query that only works with a lax GROUP BY fails in tests instead of in prod.
export function forceStrictMode(mysql: typeof import("mysql2/promise")) {
  const create = mysql.createPool;
  mysql.createPool = ((cfg: import("mysql2/promise").PoolOptions) => {
    const pool = create(cfg);
    pool.pool.on("connection", (conn) => {
      conn.query("SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
    });
    return pool;
  }) as typeof mysql.createPool;
}
