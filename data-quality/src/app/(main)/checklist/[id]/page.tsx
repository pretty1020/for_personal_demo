"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { apiGet, NO_BACKEND } from "@/lib/api-client";

export default function ChecklistPage() {
  const params = useParams();
  const id = String(params.id);
  const toast = useToast();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await apiGet(`/api/files/${id}`);
    if (!res.ok) {
      setPayload(null);
      setLoadError(res.error);
      if (res.status === 503) toast({ type: "info", message: NO_BACKEND });
      setLoading(false);
      return;
    }
    setPayload(res.data);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (loadError) return <p className="text-sm text-rose-700">{loadError}</p>;
  if (!payload?.file) return <p className="text-sm text-slate-500">Not found.</p>;
  const file = payload.file as { original_name: string };
  const checklist = (payload.checklist || []) as Array<{
    item_key: string;
    passed: boolean;
    acknowledged: boolean;
  }>;
  const defs = (payload.checklistDefs || []) as Array<{ item_key: string; label: string; is_critical: boolean }>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Checklist review"
        description={file.original_name}
        actions={
          <Link href={`/files/${id}`}>
            <Button variant="secondary" type="button">
              File details
            </Button>
          </Link>
        }
      />
      <Card title="Gate">
        <p className="text-sm text-slate-600">
          All items must pass before the file is processed. Otherwise it is rejected (see file details).
        </p>
      </Card>
      <Card title="Items">
        <ul className="divide-y divide-slate-100">
          {defs.map((d) => {
            const row = checklist.find((c) => c.item_key === d.item_key);
            const ok = row?.passed;
            return (
              <li key={d.item_key} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{d.label}</div>
                  <div className="text-xs text-slate-500">{d.is_critical ? "Critical" : "Non-critical"}</div>
                </div>
                <div className={ok ? "text-emerald-700" : "text-rose-700"}>{ok ? "Passed" : "Open"}</div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Next step">
        <p className="text-sm text-slate-600">
          No manual approval step: outcomes are applied as soon as validation finishes. Use{" "}
          <span className="font-medium">Re-run validation</span> on the file page after you fix the source data.
        </p>
        <div className="mt-3 flex gap-2">
          <Link href={`/files/${id}`}>
            <Button type="button">Return to file</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
