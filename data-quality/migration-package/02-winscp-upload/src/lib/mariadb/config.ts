export type MariaDbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit: number;
};

export function mariadbReady() {
  return Boolean(
    process.env.DB_HOST?.trim() &&
      process.env.DB_NAME?.trim() &&
      process.env.DB_USER?.trim() &&
      process.env.DB_PASSWORD !== undefined,
  );
}

export function getMariaDbConfig(): MariaDbConfig {
  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD ?? "";

  if (!host || !database || !user) {
    throw new Error("MariaDB configuration incomplete. Set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.");
  }

  const port = Number(process.env.DB_PORT || "3306");
  const connectionLimit = Number(process.env.DB_POOL_SIZE || "10");

  return {
    host,
    port: Number.isFinite(port) ? port : 3306,
    database,
    user,
    password,
    connectionLimit: Number.isFinite(connectionLimit) ? connectionLimit : 10,
  };
}
