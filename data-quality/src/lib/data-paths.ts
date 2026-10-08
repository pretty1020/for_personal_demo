import os from "node:os";
import path from "node:path";
import { isVercelRuntime } from "@/lib/storage";

/** Writable data root — project `data/` locally, `/tmp` on Vercel serverless. */
export function getDataRoot() {
  if (isVercelRuntime()) {
    return path.join(os.tmpdir(), "data-quality-tool");
  }
  return path.join(process.cwd(), "data");
}

export function standaloneStoreDir() {
  return path.join(getDataRoot(), "standalone");
}

export function standaloneStoreFile() {
  return path.join(standaloneStoreDir(), "store.json");
}

export function uploadsDir() {
  return path.join(getDataRoot(), "uploads");
}

export function processedDir(workflowId?: string) {
  const base = path.join(getDataRoot(), "processed");
  return workflowId ? path.join(base, workflowId) : base;
}

export function watchDir(workflowId: string) {
  return path.join(getDataRoot(), "watch", workflowId);
}

/** Resolve stored paths (`data/uploads/...` or absolute) to a readable file path. */
export function resolveDataPath(storagePath: string) {
  if (path.isAbsolute(storagePath)) return storagePath;
  const stripped = storagePath.replace(/^data[/\\]/, "");
  return path.join(getDataRoot(), stripped);
}

export function storePathLabel() {
  if (isVercelRuntime()) {
    return "/tmp/data-quality-tool/standalone/store.json (ephemeral)";
  }
  return "data/standalone/store.json";
}
