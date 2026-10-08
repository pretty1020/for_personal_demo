"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function MainSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[40vh] max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold text-slate-900">This page failed to load</h1>
      <p className="text-sm text-slate-600">{error.message || "Unexpected error."}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button type="button" variant="secondary" onClick={() => (window.location.href = "/dashboard")}>
          Dashboard
        </Button>
      </div>
    </div>
  );
}
