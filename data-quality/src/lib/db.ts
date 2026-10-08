import { mariadbReady } from "@/lib/mariadb/config";

export type DataBackend = "json" | "mariadb";

function envFlag(name: string, truthy: string[]) {
  const v = process.env[name]?.trim().toLowerCase();
  return truthy.includes(v ?? "");
}

export function standaloneForced() {
  return envFlag("STANDALONE", ["true", "1", "yes"]);
}

export { mariadbReady };

/** Local JSON is default. MariaDB when STANDALONE=false and DB_* env vars are set. */
export function getDataBackend(): DataBackend {
  if (envFlag("STANDALONE", ["true", "1", "yes"])) return "json";

  const explicit = process.env.DATA_BACKEND?.trim().toLowerCase();
  if (explicit === "json") return "json";

  // An explicit database request stays authoritative even when DB_* is missing or
  // misspelled. Falling back to JSON here would quietly serve the seeded demo store
  // in production and swallow every write; requireBackend() turns this into a 503.
  if (explicit === "mariadb") return "mariadb";
  if (envFlag("STANDALONE", ["false", "0", "no"])) return "mariadb";

  if (mariadbReady()) return "mariadb";

  return "json";
}

export function usesJson() {
  return getDataBackend() === "json";
}

export function usesMariaDb() {
  return getDataBackend() === "mariadb";
}
