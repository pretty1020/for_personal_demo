"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { NO_BACKEND } from "@/lib/api-client";
import type { UploadFrequency } from "@/lib/workflow-meta";

type Col = {
  column_name: string;
  data_type: "string" | "number" | "date" | "category";
  is_required: boolean;
  allowed_values: string;
};

type ChecklistEd = {
  id?: string;
  item_key: string;
  label: string;
  is_critical: boolean;
  sort_order: number;
};

export default function EditWorkflowPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [frequency, setFrequency] = useState<UploadFrequency>("daily");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [ownersText, setOwnersText] = useState("");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [sourceType, setSourceType] = useState<"upload" | "watched_folder" | "simulated_path">("upload");
  const [sourcePath, setSourcePath] = useState("");
  const [fileType, setFileType] = useState<"csv" | "xlsx">("csv");
  const [destination, setDestination] = useState("");
  const [minRows, setMinRows] = useState(1);
  const [fileNamePattern, setFileNamePattern] = useState("");
  const [sharepointUrl, setSharepointUrl] = useState("");
  const [requireYyyymmdd, setRequireYyyymmdd] = useState(true);
  const [columns, setColumns] = useState<Col[]>([]);
  const [checklist, setChecklist] = useState<ChecklistEd[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/workflows/${id}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) {
        toast({
          type: "info",
          message: NO_BACKEND,
        });
        return;
      }
      if (!res.ok) return;
      const w = json.workflow;
      setName(w.name);
      setClientName(w.client_name || "");
      setStatus(w.status);
      const st = w.source_type;
      setSourceType(
        st === "upload" || st === "simulated_path" || st === "watched_folder" ? st : "upload",
      );
      setSourcePath(w.source_path || "");
      setFileType(w.expected_file_type);
      setDestination(w.destination_label);
      const pr = (w.pass_rules || {}) as {
        min_rows?: number;
        file_name_pattern?: string;
        upload_frequency?: UploadFrequency;
        allow_duplicates?: boolean;
        data_owners?: string[];
        sharepoint_url?: string;
        require_yyyymmdd?: boolean;
      };
      setMinRows(Number(pr.min_rows ?? 1));
      setFileNamePattern(pr.file_name_pattern || "");
      setSharepointUrl(pr.sharepoint_url || "");
      setRequireYyyymmdd(pr.require_yyyymmdd !== false);
      setFrequency(pr.upload_frequency === "weekly" || pr.upload_frequency === "monthly" ? pr.upload_frequency : "daily");
      setAllowDuplicates(Boolean(pr.allow_duplicates));
      setOwnersText(Array.isArray(pr.data_owners) ? pr.data_owners.join(", ") : "");
      setColumns(
        (json.columns as { column_name: string; data_type: Col["data_type"]; is_required: boolean; allowed_values: string[] | null }[]).map(
          (c) => ({
            column_name: c.column_name,
            data_type: c.data_type,
            is_required: c.is_required,
            allowed_values: (c.allowed_values || []).join(", "),
          }),
        ),
      );
      const ch = json.checklist as ChecklistEd[] | undefined;
      setChecklist(
        Array.isArray(ch)
          ? ch.map((c) => ({
              id: c.id,
              item_key: c.item_key,
              label: c.label,
              is_critical: c.is_critical,
              sort_order: c.sort_order,
            }))
          : [],
      );
    })();
  }, [id, toast]);

  async function save() {
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
    const res = await fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        client_name: clientName.trim() || null,
        status,
        source_type: sourceType,
        source_path: sourcePath || null,
        expected_file_type: fileType,
        destination_label: destination,
        pass_rules: {
          min_rows: minRows,
          upload_frequency: frequency,
          allow_duplicates: allowDuplicates,
          data_owners: owners,
          require_yyyymmdd: requireYyyymmdd,
          sharepoint_url: sharepointUrl.trim() || null,
          ...(fileNamePattern.trim() ? { file_name_pattern: fileNamePattern.trim() } : { file_name_pattern: null }),
        },
        columns: cols.filter((c) => c.column_name),
        checklist_items: checklist
          .filter((c) => c.item_key.trim() && c.label.trim())
          .map((c) => ({
            ...(c.id ? { id: c.id } : {}),
            item_key: c.item_key.trim(),
            label: c.label.trim(),
            is_critical: c.is_critical,
            sort_order: c.sort_order,
          })),
      }),
    });
    if (!res.ok) toast({ type: "error", message: "Save failed" });
    else toast({ type: "success", message: "Workflow updated" });
  }

  async function remove() {
    if (!confirm("Delete this workflow?")) return;
    const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    if (!res.ok) toast({ type: "error", message: "Delete failed" });
    else {
      toast({ type: "success", message: "Deleted" });
      router.push("/workflows");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Edit workflow"
        description={
          <Link className="text-link" href={`/workflows/${id}`}>
            ← Back to overview
          </Link>
        }
        actions={
          <Button variant="danger" type="button" onClick={() => void remove()}>
            Delete
          </Button>
        }
      />
      <Card title="Basics">
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-slate-600">Workflow name</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-slate-600">Client name</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Shown on Dashboard"
            />
          </label>
          <label className="block">
            <span className="text-slate-600">Upload frequency</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as UploadFrequency)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Data POC / Owners</span>
            <textarea
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={ownersText}
              onChange={(e) => setOwnersText(e.target.value)}
              placeholder="Comma-separated names or emails"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={allowDuplicates}
              onChange={(e) => setAllowDuplicates(e.target.checked)}
            />
            Allow duplicate file uploads
          </label>
          <label className="block">
            <span className="text-slate-600">Filename pattern (optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono"
              value={fileNamePattern}
              onChange={(e) => setFileNamePattern(e.target.value)}
              placeholder='e.g. ^Client_Orders_\\d{8}\\.csv$'
            />
            <span className="mt-1 block text-xs text-slate-500">
              Applied on upload and Scan folder — not the workflow name.
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={requireYyyymmdd}
              onChange={(e) => setRequireYyyymmdd(e.target.checked)}
            />
            Require YYYYMMDD in filename
          </label>
          <label className="block">
            <span className="text-slate-600">SharePoint link path</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={sharepointUrl}
              onChange={(e) => setSharepointUrl(e.target.value)}
              placeholder="https://….sharepoint.com/…/Shared Documents/…"
            />
          </label>
          <label className="block">
            <span className="text-slate-600">Status</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Source type</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
            >
              <option value="upload">upload</option>
              <option value="watched_folder">watched_folder (Scan folder)</option>
              <option value="simulated_path">simulated_path</option>
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Source / scan path (optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-slate-600">Expected file type</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={fileType}
              onChange={(e) => setFileType(e.target.value as typeof fileType)}
            >
              <option value="csv">csv</option>
              <option value="xlsx">xlsx</option>
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Destination label</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-slate-600">Minimum rows</span>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
              value={minRows}
              onChange={(e) => setMinRows(Number(e.target.value))}
            />
          </label>
        </div>
      </Card>
      <Card
        title="Columns"
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
            Add
          </Button>
        }
      >
        <div className="space-y-3">
          {columns.map((col, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-12">
              <input
                className="md:col-span-3 rounded-md border border-slate-200 px-2 py-1 text-sm"
                value={col.column_name}
                onChange={(e) => {
                  const n = [...columns];
                  n[idx] = { ...col, column_name: e.target.value };
                  setColumns(n);
                }}
              />
              <select
                className="md:col-span-2 rounded-md border border-slate-200 px-2 py-1 text-sm"
                value={col.data_type}
                onChange={(e) => {
                  const n = [...columns];
                  n[idx] = { ...col, data_type: e.target.value as Col["data_type"] };
                  setColumns(n);
                }}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="category">category</option>
              </select>
              <label className="md:col-span-2 flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={col.is_required}
                  onChange={(e) => {
                    const n = [...columns];
                    n[idx] = { ...col, is_required: e.target.checked };
                    setColumns(n);
                  }}
                />
                Required
              </label>
              <input
                className="md:col-span-4 rounded-md border border-slate-200 px-2 py-1 text-sm"
                placeholder="allowed values csv"
                value={col.allowed_values}
                onChange={(e) => {
                  const n = [...columns];
                  n[idx] = { ...col, allowed_values: e.target.value };
                  setColumns(n);
                }}
              />
              <Button type="button" variant="ghost" onClick={() => setColumns(columns.filter((_, i) => i !== idx))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      </Card>
      <Card
        title="Audit rules"
        subtitle="Customize rules checked as part of audit. Engine keys (file_naming_valid, …) map to validation; custom keys require operator review."
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
          {checklist.length === 0 ? (
            <p className="text-sm text-slate-500">No audit rules yet. Add items or save defaults from the API.</p>
          ) : (
            checklist.map((row, idx) => (
              <div key={idx} className="grid gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-12">
                <input
                  className="md:col-span-3 rounded-md border border-slate-200 px-2 py-1 font-mono text-xs"
                  title="item_key"
                  value={row.item_key}
                  onChange={(e) => {
                    const n = [...checklist];
                    n[idx] = { ...row, item_key: e.target.value };
                    setChecklist(n);
                  }}
                />
                <input
                  className="md:col-span-5 rounded-md border border-slate-200 px-2 py-1 text-sm"
                  placeholder="Label"
                  value={row.label}
                  onChange={(e) => {
                    const n = [...checklist];
                    n[idx] = { ...row, label: e.target.value };
                    setChecklist(n);
                  }}
                />
                <input
                  type="number"
                  className="md:col-span-2 rounded-md border border-slate-200 px-2 py-1 text-sm"
                  title="sort_order"
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
            ))
          )}
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/workflows")}>
          Close
        </Button>
        <Button type="button" onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
