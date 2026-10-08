export const NO_BACKEND = "Backend unavailable. Check server logs.";

export async function parseJsonSafe<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? "Invalid response from server" : `Request failed (${res.status})`);
  }
}

export async function apiGet<T = Record<string, unknown>>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url);
  let data: T & { error?: string };
  try {
    data = await parseJsonSafe<T & { error?: string }>(res);
  } catch (e) {
    return {
      ok: false,
      status: res.status,
      error: e instanceof Error ? e.message : "Request failed",
    };
  }
  if (res.status === 503) return { ok: false, status: 503, error: NO_BACKEND };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
    };
  }
  return { ok: true, data };
}

export async function apiFetch<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; data: T }> {
  const res = await fetch(url, init);
  const data = await parseJsonSafe<T>(res);
  return { res, data };
}
