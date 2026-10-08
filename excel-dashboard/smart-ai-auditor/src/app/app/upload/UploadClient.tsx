"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FileType } from "@/lib/types/audit";

type Biz = { id: string; name: string };

const types: { type: FileType; label: string; hint: string }[] = [
  { type: "sales", label: "Sales report", hint: "CSV/XLSX from POS" },
  { type: "inventory", label: "Inventory report", hint: "Stock & usage" },
  { type: "expense", label: "Expense report", hint: "Bills & categories" },
  { type: "staff", label: "Staff attendance", hint: "Hours & labor cost" },
];

function safeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export function UploadClient() {
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<FileType | null>(null);
  const [progress, setProgress] = useState(0);

  const refreshBusinesses = useCallback(async () => {
    const res = await fetch("/api/business");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load businesses");
    const list = (json.businesses || []) as Biz[];
    setBusinesses(list);
    setBusinessId((cur) => cur || (list[0]?.id ?? null));
  }, []);

  useEffect(() => {
    refreshBusinesses().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [refreshBusinesses]);

  async function ensureBusiness() {
    const name = prompt("Business name", "My Cafe");
    if (!name) return;
    const res = await fetch("/api/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || "Could not create");
      return;
    }
    setBusinessId(json.business.id);
    await refreshBusinesses();
  }

  async function seedDemo() {
    if (!businessId) return;
    setMessage(null);
    setError(null);
    setBusyType("sales");
    setProgress(15);
    try {
      const res = await fetch("/api/demo-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Demo failed");
      setProgress(100);
      setMessage("Demo data loaded. Open the dashboard and run an AI audit.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo error");
    } finally {
      setBusyType(null);
      setProgress(0);
    }
  }

  async function resetAll() {
    if (!businessId) return;
    if (!confirm("Delete uploads, operational rows, findings, and reports for this business?")) return;
    setMessage(null);
    setError(null);
    const res = await fetch("/api/reset-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Reset failed");
      return;
    }
    setMessage("Data reset for this business.");
  }

  async function onPick(file: File | null, fileType: FileType) {
    setMessage(null);
    setError(null);
    if (!businessId || !file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      setError("Please upload a CSV or Excel (.xlsx/.xls) file.");
      return;
    }

    setBusyType(fileType);
    setProgress(8);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const uploadId = crypto.randomUUID();
      const path = `${user.id}/${businessId}/${uploadId}_${safeFileName(file.name)}`;

      setProgress(25);
      const up = await supabase.storage.from("reports").upload(path, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });
      if (up.error) throw new Error(up.error.message);

      setProgress(45);
      const reg = await fetch("/api/uploads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          fileType,
          storagePath: path,
          originalName: file.name,
        }),
      });
      const regJson = await reg.json();
      if (!reg.ok) throw new Error(regJson.error || "Could not register upload");

      setProgress(70);
      const ing = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: regJson.upload.id }),
      });
      const ingJson = await ing.json();
      if (!ing.ok) throw new Error(ingJson.error || "Could not parse file");

      setProgress(100);
      setMessage(`${fileType} file processed (${ingJson.rows ?? "?"} rows).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyType(null);
      setTimeout(() => setProgress(0), 400);
    }
  }

  if (!businesses.length) {
    return (
      <div className="rounded-3xl border border-dashed border-navy-900/20 bg-white p-10 text-center dark:border-white/15 dark:bg-navy-900/40">
        <h1 className="font-display text-2xl">Create a business first</h1>
        <button
          type="button"
          onClick={ensureBusiness}
          className="mt-6 rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-cream-50 hover:bg-navy-850 dark:bg-gold-400 dark:text-navy-950"
        >
          Create business
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl text-navy-950 dark:text-cream-50">Upload center</h1>
          <p className="mt-1 text-sm text-navy-900/70 dark:text-cream-200/75">
            Files go to Supabase Storage, then normalize into typed tables for auditing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-navy-900/60 dark:text-cream-200/60">
            Business
            <select
              className="ml-2 rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-navy-900"
              value={businessId || ""}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={seedDemo}
            disabled={busyType !== null}
            className="rounded-full border border-navy-900/15 bg-white px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-cream-100 disabled:opacity-50 dark:border-white/10 dark:bg-navy-900 dark:text-cream-50 dark:hover:bg-navy-850"
          >
            Load demo data
          </button>
          <button
            type="button"
            onClick={resetAll}
            disabled={busyType !== null}
            className="rounded-full border border-red-300/70 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-50 dark:hover:bg-red-500/20"
          >
            Reset data
          </button>
        </div>
      </div>

      {progress > 0 && (
        <div className="rounded-2xl border border-navy-900/10 bg-white p-4 dark:border-white/10 dark:bg-navy-900/50">
          <div className="flex items-center justify-between text-xs font-semibold text-navy-900/70 dark:text-cream-200/70">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-navy-900/10 dark:bg-white/10">
            <div
              className="h-2 rounded-full bg-gold-400 transition-all"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-50">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-300/60 bg-red-50 p-4 text-sm text-red-900 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-50">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {types.map((t) => (
          <label
            key={t.type}
            className="group cursor-pointer rounded-3xl border border-navy-900/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-navy-900/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-navy-950 dark:text-cream-50">{t.label}</p>
                <p className="mt-1 text-xs text-navy-900/65 dark:text-cream-200/70">{t.hint}</p>
              </div>
              <span className="rounded-full bg-navy-900/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-navy-900/60 dark:bg-white/5 dark:text-cream-200/70">
                {t.type}
              </span>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="mt-4 block w-full text-xs file:mr-3 file:rounded-full file:border-0 file:bg-gold-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-navy-950 hover:file:bg-gold-300"
              disabled={busyType !== null}
              onChange={(e) => onPick(e.target.files?.[0] ?? null, t.type)}
            />
            {busyType === t.type && <p className="mt-2 text-xs text-gold-700 dark:text-gold-300">Working…</p>}
          </label>
        ))}
      </div>

      <div className="rounded-3xl border border-navy-900/10 bg-white p-5 text-sm text-navy-900/75 dark:border-white/10 dark:bg-navy-900/50 dark:text-cream-200/80">
        <p className="font-semibold text-navy-950 dark:text-cream-50">Templates</p>
        <p className="mt-2">
          Download sample CSV layouts from{" "}
          <a className="font-semibold text-gold-700 underline dark:text-gold-300" href="/samples/sales_template.csv">
            sales
          </a>
          ,{" "}
          <a className="font-semibold text-gold-700 underline dark:text-gold-300" href="/samples/inventory_template.csv">
            inventory
          </a>
          ,{" "}
          <a className="font-semibold text-gold-700 underline dark:text-gold-300" href="/samples/expense_template.csv">
            expenses
          </a>
          ,{" "}
          <a className="font-semibold text-gold-700 underline dark:text-gold-300" href="/samples/staff_template.csv">
            staff
          </a>
          .
        </p>
      </div>
    </div>
  );
}
