import { NextResponse } from "next/server";
import { getDataBackend, mariadbReady } from "@/lib/db";

export function requireBackend() {
  // Order matters: ask for the backend first. usesJson() is itself derived from
  // getDataBackend(), so returning early on it would hide a misconfigured MariaDB.
  const backend = getDataBackend();
  if (backend === "mariadb" && !mariadbReady()) {
    return NextResponse.json(
      {
        error:
          "MariaDB is selected but not configured. Set DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD in .env.local, then restart.",
      },
      { status: 503 },
    );
  }
  return null;
}
