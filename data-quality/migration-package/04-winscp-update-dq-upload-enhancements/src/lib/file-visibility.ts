export type FileVisibility = "public" | "private";

export function normalizeVisibility(raw: unknown): FileVisibility {
  return raw === "private" ? "private" : "public";
}

export function getFileVisibility(metadata: Record<string, unknown> | null | undefined): FileVisibility {
  return normalizeVisibility(metadata?.visibility);
}

export function isPrivateFile(metadata: Record<string, unknown> | null | undefined): boolean {
  return getFileVisibility(metadata) === "private";
}

/** Strip preview rows from metadata when the file is private. */
export function redactPrivatePreview<T extends { metadata?: Record<string, unknown> | null }>(
  file: T,
): T {
  if (!file?.metadata || !isPrivateFile(file.metadata)) return file;
  const meta = { ...file.metadata };
  delete meta.preview_rows;
  return { ...file, metadata: meta };
}
