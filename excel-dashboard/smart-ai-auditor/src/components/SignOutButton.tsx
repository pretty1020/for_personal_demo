"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.replace("/auth");
        router.refresh();
      }}
      className="rounded-full border border-navy-900/10 bg-white px-3 py-2 text-xs font-semibold text-navy-900 hover:bg-cream-100 dark:border-white/10 dark:bg-navy-900 dark:text-cream-100 dark:hover:bg-navy-850"
    >
      Sign out
    </button>
  );
}
