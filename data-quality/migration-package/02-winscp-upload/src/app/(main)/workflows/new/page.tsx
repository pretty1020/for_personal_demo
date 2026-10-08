"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { NO_BACKEND } from "@/lib/api-client";

type Col = {
  column_name: string;
  data_type: "string" | "number" | "date" | "category";
  is_required: boolean;
  allowed_values: string;
};

export default function NewWorkflowPage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("New intake workflow");
  const [sourceType, setSourceType] = useState<"upload" | "simulated_path">("upload");
  const [sourcePath, setSourcePath] = useState("");
  const [fileType, setFileType] = useState<"csv" | "xlsx">("csv");
  const [destination, setDestination] = useState("Processed");
  const [minRows, setMinRows] = useState(1);
  const [columns, setColumns] = useState<Col[]>([
    { column_name: "id", data_type: "string", is_required: true, allowed_values: "" },
  ]);

  async function submit() {
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
        source_type: sourceType,
        source_path: sourcePath || null,
        expected_file_type: fileType,
        destination_label: destination,
        pass_rules: {
          min_rows: minRows,
        },
        columns: cols.filter((c) => c.column_name),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 503) {
      toast({
        type: "info",
        message: NO_BACKEND,
      });
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
        description="Set up validation rules, required columns, and intake settings."
      />
      <Card title="Basics">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600">Name</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Source type</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
            >
              <option value="upload">Upload</option>
              <option value="simulated_path">Simulated local path</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Simulated / watch path (optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="e.g. C:\\data\\inbox or leave blank for ./data/watch/{workflowId}"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Expected file type</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={fileType}
              onChange={(e) => setFileType(e.target.value as typeof fileType)}
            >
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Destination label after validation</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Minimum rows</span>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={minRows}
              onChange={(e) => setMinRows(Number(e.target.value))}
            />
          </label>
        </div>
      </Card>
      <Card
        title="Required columns"
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
                className="md:col-span-3 rounded-md border border-slate-200 px-2 py-1 text-sm"
                placeholder="column_name"
                value={col.column_name}
                onChange={(e) => {
                  const next = [...columns];
                  next[idx] = { ...col, column_name: e.target.value };
                  setColumns(next);
                }}
              />
              <select
                className="md:col-span-2 rounded-md border border-slate-200 px-2 py-1 text-sm"
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
                className="md:col-span-4 rounded-md border border-slate-200 px-2 py-1 text-sm"
                placeholder="Allowed values (comma) for category"
                value={col.allowed_values}
                onChange={(e) => {
                  const next = [...columns];
                  next[idx] = { ...col, allowed_values: e.target.value };
                  setColumns(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                className="md:col-span-1"
                onClick={() => setColumns(columns.filter((_, i) => i !== idx))}
              >
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
