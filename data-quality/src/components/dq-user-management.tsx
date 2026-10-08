"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseJsonSafe } from "@/lib/api-client";

type DqUserRow = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  isActive: boolean;
};

export function DqUserManagementPanel() {
  const [users, setUsers] = useState<DqUserRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/dq-users", { credentials: "include" });
    const json = await parseJsonSafe<{ users?: DqUserRow[]; error?: string }>(res);
    if (!res.ok) {
      setError(json.error || "Could not load Data Quality users.");
      setUsers([]);
      return;
    }
    setUsers(json.users || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/dq-users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const json = await parseJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        setError(json.error || "Could not create user.");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string, isActive: boolean) {
    setError("");
    const res = await fetch(`/api/dq-users/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    const json = await parseJsonSafe<{ error?: string }>(res);
    if (!res.ok) {
      setError(json.error || "Update failed.");
      return;
    }
    await load();
  }

  async function removeUser(id: string) {
    if (!window.confirm("Delete this Data Quality user?")) return;
    setError("");
    const res = await fetch(`/api/dq-users/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const json = await parseJsonSafe<{ error?: string }>(res);
    if (!res.ok) {
      setError(json.error || "Delete failed.");
      return;
    }
    await load();
  }

  return (
    <Card
      title="Data Quality users"
      subtitle="Admins grant access to Dashboard, Upload, Workflows, Reports, Audit, and Settings."
    >
      <form className="mb-6 grid gap-3 md:grid-cols-2" onSubmit={(e) => void onCreate(e)}>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user")}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="md:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Grant access"}
          </Button>
        </div>
      </form>

      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Email</th>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border-subtle)]">
                <td className="px-2 py-2">{u.name}</td>
                <td className="px-2 py-2">{u.email}</td>
                <td className="px-2 py-2 capitalize">{u.role}</td>
                <td className="px-2 py-2">{u.isActive ? "Active" : "Inactive"}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void setActive(u.id, !u.isActive)}
                    >
                      {u.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button type="button" variant="danger" onClick={() => void removeUser(u.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-slate-500">
                  No users yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
