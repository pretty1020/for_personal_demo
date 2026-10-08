"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button, buttonLinkClass } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";
import Link from "next/link";

type Wf = { id: string; name: string };

export default function IntakePage() {
  const toast = useToast();
  const [workflows, setWorkflows] = useState<Wf[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [drag, setDrag] = useState(false);
  const [history, setHistory] = useState<{ id: string; name: string; at: string }[]>([]);

  const loadWf = useCallback(async () => {
    const res = await fetch("/api/workflows");
    if (res.status === 503) {
      toast({ type: "info", message: NO_BACKEND });
      return;
    }
    if (!res.ok) return;
    const json = await parseJsonSafe<{ workflows?: Wf[] }>(res);
    const list = (json.workflows || []) as Wf[];
    setWorkflows(list);
    setWorkflowId((cur) => cur || list[0]?.id || "");
  }, [toast]);

  useEffect(() => {
    void loadWf();
  }, [loadWf]);

  async function uploadFile(file: File) {
    if (!workflowId) {
      toast({ type: "error", message: "Select a workflow" });
      return;
    }
    const fd = new FormData();
    fd.set("workflowId", workflowId);
    fd.set("file", file);
    const res = await fetch("/api/files/upload", { method: "POST", body: fd });
    let json: { error?: string; file?: { id: string } } = {};
    try {
      json = await parseJsonSafe(res);
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Upload failed" });
      return;
    }
    if (res.status === 409) {
      toast({ type: "info", message: "Duplicate prevented for this workflow" });
      return;
    }
    if (!res.ok) {
      toast({ type: "error", message: json.error || "Upload failed" });
      return;
    }
    toast({ type: "success", message: "Uploaded — validation queued" });
    if (json.file?.id) {
      setHistory((h) => [{ id: json.file!.id, name: file.name, at: new Date().toISOString() }, ...h].slice(0, 20));
    }
  }

  async function scan() {
    if (!workflowId) return;
    const res = await fetch(`/api/workflows/${workflowId}/scan`, { method: "POST" });
    try {
      const json = await parseJsonSafe<{ error?: string; ingested?: number }>(res);
      if (!res.ok) toast({ type: "error", message: json.error || "Scan failed" });
      else toast({ type: "success", message: `Scan complete — ${json.ingested ?? 0} new file(s)` });
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Scan failed" });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload files"
        description="Submit CSV or Excel files for validation. Choose a workflow, then drag and drop or browse."
      />

      <Card title="Select workflow">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-sm font-medium text-slate-700">
            Workflow
            <select
              className="form-input mt-1 min-w-[200px]"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
            >
              <option value="">{workflows.length ? "Choose a workflow…" : "Loading…"}</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={() => void scan()}>
            Scan folder
          </Button>
        </div>
      </Card>

      <Card title="Upload" subtitle="Supported formats: CSV, XLSX, XLS">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void uploadFile(f);
          }}
          className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm transition ${
            drag ? "border-brand-600 bg-brand-50/80 ring-2 ring-brand-600/10" : "border-[var(--border)] bg-[var(--card-header)]"
          }`}
        >
          <svg className="mb-3 h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <p className="font-medium text-slate-800">Drop your file here</p>
          <p className="mt-1 text-slate-500">or click to browse</p>
          <label className="mt-4">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
            <span className={buttonLinkClass("secondary", "cursor-pointer")}>Choose file</span>
          </label>
        </div>
      </Card>

      <Card title="Recent uploads">
        <ul className="divide-y divide-slate-100 text-sm">
          {history.length === 0 && <li className="py-4 text-slate-500">No uploads in this session.</li>}
          {history.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 py-3">
              <Link className="text-link" href={`/files/${h.id}`}>
                {h.name}
              </Link>
              <span className="text-slate-500">{new Date(h.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
