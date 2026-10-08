import fs from "node:fs/promises";
import path from "node:path";
import { processedDir, resolveDataPath, uploadsDir } from "@/lib/data-paths";

export function isVercelRuntime() {
  return process.env.VERCEL === "1";
}

export async function saveUploadFile(input: {
  workflowId: string;
  fileId: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string | null;
}): Promise<string> {
  const { fileId, fileName, buffer } = input;
  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
  const safeName = fileName.replace(/[^\w.\-()+ ]/g, "_");
  const fileBase = `${fileId}_${safeName}`;
  await fs.writeFile(path.join(dir, fileBase), buffer);
  return path.join("data", "uploads", fileBase);
}

export async function readFileBytes(storagePath: string): Promise<Buffer> {
  const abs = resolveDataPath(storagePath);
  return fs.readFile(abs);
}

export async function promoteToProcessed(input: {
  storagePath: string;
  workflowId: string;
  fileId: string;
  fileName: string;
}): Promise<string> {
  const { storagePath, workflowId, fileId, fileName } = input;
  const src = resolveDataPath(storagePath);
  const destDir = processedDir(workflowId || "unassigned");
  await fs.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, `${fileId}_${fileName}`);
  await fs.copyFile(src, destPath);
  return destPath;
}
