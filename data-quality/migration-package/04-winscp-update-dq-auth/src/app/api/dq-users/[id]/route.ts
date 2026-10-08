import { NextResponse, type NextRequest } from "next/server";
import { requireDqAdmin } from "@/lib/api-guard";
import {
  countDqAdmins,
  deleteDqUser,
  findDqUserById,
  updateDqUser,
  type DqRole,
} from "@/lib/dq-auth";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireDqAdmin(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const existing = await findDqUserById(id);
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  let body: {
    email?: string;
    name?: string;
    role?: string;
    isActive?: boolean;
    password?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const nextRole: DqRole | undefined =
    body.role === undefined ? undefined : body.role === "admin" ? "admin" : "user";

  if (
    existing.role === "admin" &&
    (nextRole === "user" || body.isActive === false)
  ) {
    const admins = await countDqAdmins();
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot remove or demote the last active admin." },
        { status: 400 },
      );
    }
  }

  if (body.password !== undefined && body.password.trim() && body.password.trim().length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    const user = await updateDqUser(id, {
      email: body.email,
      name: body.name,
      role: nextRole,
      isActive: body.isActive,
      password: body.password,
    });
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Duplicate|ER_DUP_ENTRY/i.test(message)) {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireDqAdmin(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  if (auth.user.id === id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const existing = await findDqUserById(id);
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (existing.role === "admin") {
    const admins = await countDqAdmins();
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last active admin." },
        { status: 400 },
      );
    }
  }

  await deleteDqUser(id);
  return NextResponse.json({ ok: true });
}
