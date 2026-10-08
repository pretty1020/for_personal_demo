import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { mariadbListNotifications, mariadbMarkNotificationsRead } from "@/lib/mariadb/repository";
import { readStandalone, writeStandalone } from "@/lib/standalone/store";

export async function GET() {
  const blocked = requireBackend();
  if (blocked) return blocked;
  if (usesJson()) {
    const notifications = await readStandalone((s) =>
      [...s.notifications].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 100),
    );
    return NextResponse.json({ notifications });
  }
  const notifications = await mariadbListNotifications(100);
  return NextResponse.json({ notifications });
}

export async function PATCH(req: Request) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  const markAll = Boolean(body.markAllRead);
  if (usesJson()) {
    await writeStandalone((s) => {
      if (markAll) {
        for (const n of s.notifications) {
          if (!n.read) n.read = true;
        }
        return;
      }
      if (!id) return;
      const n = s.notifications.find((x) => x.id === id);
      if (n) n.read = true;
    });
    return NextResponse.json({ ok: true });
  }
  if (markAll) {
    await mariadbMarkNotificationsRead(true);
    return NextResponse.json({ ok: true });
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await mariadbMarkNotificationsRead(false, [id]);
  return NextResponse.json({ ok: true });
}
