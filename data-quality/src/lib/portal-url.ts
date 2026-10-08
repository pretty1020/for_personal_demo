/** Same-site portal in production. Local dev still opens the Vite app. */
export const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ??
  (process.env.NODE_ENV === "production" ? "/" : "http://127.0.0.1:5173");
