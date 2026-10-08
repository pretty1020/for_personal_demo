import { NextResponse } from "next/server";
import { getDataBackend, mariadbReady } from "@/lib/db";
import { pingMariaDb } from "@/lib/mariadb/pool";
import { storePathLabel } from "@/lib/data-paths";
import { isVercelRuntime } from "@/lib/storage";

export async function GET() {
  const backend = getDataBackend();
  const json = backend === "json";
  const onVercel = isVercelRuntime();
  const mariadb = backend === "mariadb";
  let dbConnected = json;

  if (mariadb) {
    dbConnected = await pingMariaDb();
  }

  return NextResponse.json({
    standalone: json,
    mariadb: mariadbReady(),
    jsonBackend: json,
    dataMode: backend,
    dataBackend: backend,
    vercel: onVercel,
    ephemeralStorage: onVercel && json,
    productionReady: json || dbConnected,
    dbConnected,
    folderScanSupported: !onVercel,
    storePath: json ? storePathLabel() : null,
  });
}
