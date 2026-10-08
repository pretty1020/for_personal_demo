"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { WorkflowStatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { NO_BACKEND } from "@/lib/api-client";

export default function WorkflowDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const toast = useToast();
  const [data, setData] = useState<{
    workflow: Record<string, unknown>;
    columns: unknown[];
    checklist: unknown[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);
      const res = await fetch(`/api/workflows/${id}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setData(null);
        setLoadError(NO_BACKEND);
        toast({ type: "info", message: NO_BACKEND });
        setLoading(false);
        return;
      }
      if (res.ok) setData(json);
      else setLoadError(typeof json.error === "string" ? json.error : "Could not load workflow");
      setLoading(false);
    })();
  }, [id, toast]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (loadError) return <p className="text-sm text-rose-700">{loadError}</p>;
  if (!data) return <p className="text-sm text-slate-500">Not found.</p>;
  const w = data.workflow as {
    name: string;
    status: string;
    source_type: string;
    expected_file_type: string;
    destination_label: string;
    pass_rules: Record<string, unknown>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={w.name}
        description="Workflow configuration and validation rules."
        actions={
          <div className="flex gap-2">
            <Link href={`/workflows/${id}/edit`}>
              <Button type="button" variant="secondary">
                Edit
              </Button>
            </Link>
            <Link href="/intake">
              <Button type="button">Upload file</Button>
            </Link>
          </div>
        }
      />
      <Card title="Summary">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="text-slate-500">Status</div>
            <WorkflowStatusBadge status={w.status} />
          </div>
          <div>
            <div className="text-slate-500">Source</div>
            <div className="font-medium text-slate-900">{w.source_type}</div>
          </div>
          <div>
            <div className="text-slate-500">Expected type</div>
            <div className="font-medium text-slate-900">{w.expected_file_type}</div>
          </div>
          <div>
            <div className="text-slate-500">Destination label</div>
            <div className="font-medium text-slate-900">{w.destination_label}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-slate-500">Pass rules</div>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--card-header)] p-3 text-xs text-[var(--foreground)] ring-1 ring-[var(--border-subtle)]">
              {JSON.stringify(w.pass_rules || {}, null, 2)}
            </pre>
          </div>
        </div>
      </Card>
      <Card title="Required columns">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          {(data.columns as { column_name: string; data_type: string; is_required: boolean }[]).map((c) => (
            <li key={c.column_name}>
              <span className="font-medium">{c.column_name}</span> — {c.data_type}{" "}
              {c.is_required ? "(required)" : "(optional)"}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Checklist template">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          {(data.checklist as { label: string; is_critical: boolean }[]).map((c) => (
            <li key={c.label}>
              {c.label} {c.is_critical ? "(critical)" : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
