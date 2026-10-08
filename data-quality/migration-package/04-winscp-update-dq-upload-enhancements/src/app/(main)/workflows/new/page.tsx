"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";
import type { UploadFrequency } from "@/lib/workflow-meta";

type Col = {
  column_name: string;
  data_type: "string" | "number" | "date" | "category";
  is_required: boolean;
  allowed_values: string;
};

type ChecklistEd = {
  item_key: string;
  label: string;
  is_critical: boolean;
  sort_order: number;
};

export default function NewWorkflowPage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("New intake workflow");
  const [clientName, setClientName] = useState("");
  const [frequency, setFrequency] = useState<UploadFrequency>("daily");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [ownersText, setOwnersText] = useState("");
  const [sourceType, setSourceType] = useState<"upload" | "watched_folder" | "simulated_path">("upload");
  const [sourcePath, setSourcePath] = useState("");
  const [fileType, setFileType] = useState<"csv" | "xlsx">("csv");
  const [destination, setDestination] = useState("Processed");
  const [minRows, setMinRows] = useState(1);
  const [fileNamePattern, setFileNamePattern] = useState("");
  const [sharepointUrl, setSharepointUrl] = useState("");
  const [requireYyyymmdd, setRequireYyyymmdd] = useState(true);
  const [sampleFileName, setSampleFileName] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [columns, setColumns] = useState<Col[]>([
    { column_name: "id", data_type: "string", is_required: true, allowed_values: "" },
  ]);
  const [checklist, setChecklist] = useState<ChecklistEd[]>(
    DEFAULT_CHECKLIST_ITEMS.map((c) => ({ ...c })),
  );

  async function inspectSample(file: File) {
    setInspecting(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/workflows/inspect", { method: "POST", body: fd });
      const json = await parseJsonSafe<{
        error?: string;
        fileName?: string;
        suggestedFileNamePattern?: string;
        expectedFileType?: "csv" | "xlsx";
        columns?: Array<{
          column_name: string;
          data_type: Col["data_type"];
          is_required: boolean;
        }>;
        rowCount?: number;
      }>(res);
      if (!res.ok) {
        toast({ type: "error", message: json.error || "Could not inspect file" });
        return;
      }
      setSampleFileName(json.fileName || file.name);
      if (json.suggestedFileNamePattern) setFileNamePattern(json.suggestedFileNamePattern);
      if (json.expectedFileType) setFileType(json.expectedFileType);
      if (json.columns?.length) {
        setColumns(
          json.columns.map((c) => ({
            column_name: c.column_name,
            data_type: c.data_type,
            is_required: c.is_required,
            allowed_values: "",
          })),
        );
      }
      if (!name || name === "New intake workflow") {
        const base = (json.fileName || file.name).replace(/\.[^.]+$/, "");
        setName(base || "New intake workflow");
      }
      toast({
        type: "success",
        message: `Detected ${json.columns?.length ?? 0} columns from ${json.fileName} (${json.rowCount ?? 0} rows)`,
      });
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Inspect failed" });
    } finally {
      setInspecting(false);
    }
  }

  async function submit() {
    const owners = ownersText
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const cols = columns.map((c) => ({
      column_name: c.column_name.trim(),
      data_type: c.data_type,
      is_required: c.is_required,
      allowed_values:
        c.data_type === "category" && c.allowed_values
          ? c.allowed_values.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
      pattern: null,
    }));
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        client_name: clientName.trim() || null,
        source_type: sourceType,
        source_path: sourcePath || null,
        expected_file_type: fileType,
        destination_label: destination,
        upload_frequency: frequency,
        allow_duplicates: allowDuplicates,
        data_owners: owners,
        pass_rules: {
          min_rows: minRows,
          require_yyyymmdd: requireYyyymmdd,
          ...(fileNamePattern.trim() ? { file_name_pattern: fileNamePattern.trim() } : {}),
          ...(sharepointUrl.trim() ? { sharepoint_url: sharepointUrl.trim() } : {}),
        },
        columns: cols.filter((c) => c.column_name),
        checklist_items: checklist
          .filter((c) => c.item_key.trim() && c.label.trim())
          .map((c) => ({
            item_key: c.item_key.trim(),
            label: c.label.trim(),
            is_critical: c.is_critical,
            sort_order: c.sort_order,
          })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 503) {
      toast({ type: "info", message: NO_BACKEND });
      return;
    }
    if (!res.ok) {
      toast({ type: "error", message: json.error ? JSON.stringify(json.error) : "Create failed" });
      return;
    }
    toast({ type: "success", message: "Workflow created" });
    router.push(`/workflows/${json.workflow.id}/edit`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Create workflow"
        description="Set frequency, owners, filename rules, and auto-detect columns from a sample file."
      />

      <Card title="Sample file" subtitle="Upload a CSV/XLSX to auto-detect filename, columns, and data types.">
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--card-header)] px-4 py-8 text-sm transition hover:border-brand-600/40">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              disabled={inspecting}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void inspectSample(f);
              }}
            />
            <p className="font-medium text-slate-800">{inspecting ? "Detecting…" : "Choose sample file"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {sampleFileName ? `Loaded: ${sampleFileName}` : "Columns and types become editable below"}
            </p>
          </label>
        </div>
      </Card>

      <Card title="Basics">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600">Workflow name</span>
            <input className="form-input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Client name</span>
            <input
              className="form-input mt-1 w-full"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Shown on Dashboard"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Upload frequency</span>
            <select
              className="form-input mt-1 w-full"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as UploadFrequency)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Used for Done / Not Done / Delayed tracking on the Dashboard.
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Data POC / Owners</span>
            <textarea
              className="form-input mt-1 w-full min-h-[72px]"
              value={ownersText}
              onChange={(e) => setOwnersText(e.target.value)}
              placeholder="Comma or new-line separated (e.g. Jane Doe, john@movate.com)"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={allowDuplicates}
              onChange={(e) => setAllowDuplicates(e.target.checked)}
            />
            Allow duplicate file uploads (same content hash)
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Filename pattern</span>
            <input
              className="form-input mt-1 w-full font-mono text-sm"
              value={fileNamePattern}
              onChange={(e) => setFileNamePattern(e.target.value)}
              placeholder="Auto-filled from sample, or regex e.g. ^Orders_\\d{8}\\.csv$"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Prefer a pattern with a dynamic YYYYMMDD slot so period status can be matched on the Dashboard.
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={requireYyyymmdd}
              onChange={(e) => setRequireYyyymmdd(e.target.checked)}
            />
            Require YYYYMMDD in filename (used for period alerts)
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">SharePoint link path</span>
            <input
              className="form-input mt-1 w-full"
              value={sharepointUrl}
              onChange={(e) => setSharepointUrl(e.target.value)}
              placeholder="https://contoso.sharepoint.com/sites/.../Shared Documents/..."
            />
            <span className="mt-1 block text-xs text-slate-500">
              Shown on processed files so operators can open SharePoint and mark upload complete.
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Source type</span>
            <select
              className="form-input mt-1 w-full"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
            >
              <option value="upload">Upload</option>
              <option value="watched_folder">Watched folder (Scan folder)</option>
              <option value="simulated_path">Simulated local path</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Scan / watch path (optional)</span>
            <input
              className="form-input mt-1 w-full"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="Leave blank for ./data/watch/{workflowId}"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">Expected file type</span>
              <select
                className="form-input mt-1 w-full"
                value={fileType}
                onChange={(e) => setFileType(e.target.value as typeof fileType)}
              >
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Minimum rows</span>
              <input
                type="number"
                min={1}
                className="form-input mt-1 w-full"
                value={minRows}
                onChange={(e) => setMinRows(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Destination label</span>
            <input
              className="form-input mt-1 w-full"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
        </div>
      </Card>

      <Card
        title="Columns"
        subtitle="Edit detected data types before saving."
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setColumns((c) => [
                ...c,
                { column_name: "", data_type: "string", is_required: true, allowed_values: "" },
              ])
            }
          >
            Add column
          </Button>
        }
      >
        <div className="space-y-3">
          {columns.map((col, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-12">
              <input
                className="form-input md:col-span-3"
                placeholder="column_name"
                value={col.column_name}
                onChange={(e) => {
                  const next = [...columns];
                  next[idx] = { ...col, column_name: e.target.value };
                  setColumns(next);
                }}
              />
              <select
                className="form-input md:col-span-2"
                value={col.data_type}
                onChange={(e) => {
                  const next = [...columns];
                  next[idx] = { ...col, data_type: e.target.value as Col["data_type"] };
                  setColumns(next);
                }}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="category">category</option>
              </select>
              <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={col.is_required}
                  onChange={(e) => {
                    const next = [...columns];
                    next[idx] = { ...col, is_required: e.target.checked };
                    setColumns(next);
                  }}
                />
                Required
              </label>
              <input
                className="form-input md:col-span-4"
                placeholder="Allowed values (comma) for category"
                value={col.allowed_values}
                onChange={(e) => {
                  const next = [...columns];
                  next[idx] = { ...col, allowed_values: e.target.value };
                  setColumns(next);
                }}
              />
              <Button type="button" variant="ghost" className="md:col-span-1" onClick={() => setColumns(columns.filter((_, i) => i !== idx))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Audit rules"
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setChecklist((rows) => {
                const nextSort = rows.length ? Math.max(...rows.map((r) => r.sort_order), 0) + 10 : 10;
                return [
                  ...rows,
                  {
                    item_key: `custom_${rows.length + 1}`,
                    label: "New audit rule",
                    is_critical: true,
                    sort_order: nextSort,
                  },
                ];
              })
            }
          >
            Add rule
          </Button>
        }
      >
        <div className="space-y-3">
          {checklist.map((row, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-12">
              <input
                className="form-input md:col-span-3 font-mono text-xs"
                value={row.item_key}
                onChange={(e) => {
                  const n = [...checklist];
                  n[idx] = { ...row, item_key: e.target.value };
                  setChecklist(n);
                }}
              />
              <input
                className="form-input md:col-span-5"
                value={row.label}
                onChange={(e) => {
                  const n = [...checklist];
                  n[idx] = { ...row, label: e.target.value };
                  setChecklist(n);
                }}
              />
              <input
                type="number"
                className="form-input md:col-span-2"
                value={row.sort_order}
                onChange={(e) => {
                  const n = [...checklist];
                  n[idx] = { ...row, sort_order: Number(e.target.value) || 0 };
                  setChecklist(n);
                }}
              />
              <label className="md:col-span-1 flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={row.is_critical}
                  onChange={(e) => {
                    const n = [...checklist];
                    n[idx] = { ...row, is_critical: e.target.checked };
                    setChecklist(n);
                  }}
                />
                Critical
              </label>
              <Button type="button" variant="ghost" onClick={() => setChecklist(checklist.filter((_, i) => i !== idx))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void submit()}>
          Save workflow
        </Button>
      </div>
    </div>
  );
}
