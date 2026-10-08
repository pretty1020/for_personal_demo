import Link from "next/link";

const steps = [
  {
    title: "1. Connect Supabase",
    body: "Create a Supabase project, run the SQL in supabase/schema.sql, and add NEXT_PUBLIC_SUPABASE_URL plus keys to your environment.",
  },
  {
    title: "2. Create your business",
    body: "After email login, create a business profile. All uploads attach to this business.",
  },
  {
    title: "3. Upload four report types",
    body: "Sales, inventory, expenses, and staff attendance. CSV or XLSX from POS, inventory apps, or spreadsheets all work.",
  },
  {
    title: "4. Run the AI audit",
    body: "Open the dashboard and tap “Refresh AI audit”. We combine rule-based checks with OpenAI explanations using only your numbers.",
  },
  {
    title: "5. Download reports",
    body: "Use Reports to export a PDF executive summary or an Excel workbook for your accountant.",
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-cream-50 text-navy-950 dark:bg-navy-950 dark:text-cream-100">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link href="/" className="text-sm font-semibold text-gold-600 hover:underline dark:text-gold-300">
          ← Back to home
        </Link>
        <h1 className="mt-6 font-display text-4xl">Owner user guide</h1>
        <p className="mt-3 text-lg text-navy-900/80 dark:text-cream-200/80">
          Smart AI Auditor is designed for busy owners: upload, review KPIs, scan for leaks, then act.
        </p>

        <ol className="mt-10 space-y-6">
          {steps.map((s) => (
            <li key={s.title} className="rounded-2xl border border-navy-900/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-navy-900/60">
              <p className="font-semibold text-navy-950 dark:text-cream-50">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-navy-900/75 dark:text-cream-200/80">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 rounded-2xl border border-amber-200/80 bg-amber-50 p-5 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-50">
          <p className="font-semibold">AI safety</p>
          <p className="mt-2">
            The assistant is instructed not to invent metrics. If a file is missing, the dashboard and
            findings will say exactly what is missing so you can upload the right export.
          </p>
        </div>

        <div className="mt-8">
          <Link
            href="/auth"
            className="inline-flex rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-cream-50 hover:bg-navy-850 dark:bg-gold-400 dark:text-navy-950 dark:hover:bg-gold-300"
          >
            Go to login
          </Link>
        </div>
      </div>
    </div>
  );
}
