import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

const benefits = [
  { title: "Detect waste", body: "Connect spoilage signals with usage vs sales." },
  { title: "Find low-margin menu items", body: "See what sells vs what actually earns." },
  { title: "Identify dead hours", body: "Spot quiet blocks that drag labor efficiency." },
  { title: "Spot inventory gaps", body: "Highlight mismatches between movement and revenue." },
  { title: "Get AI action plans", body: "Practical 7-day steps tailored to small teams." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-navy-950 via-navy-900 to-navy-950 text-cream-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/20" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gold-300/90">Smart AI Auditor</p>
            <p className="font-display text-lg text-cream-50">Cafes & Restaurants</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/auth"
            className="rounded-full bg-cream-50 px-4 py-2 text-sm font-semibold text-navy-950 shadow-soft hover:bg-cream-100"
          >
            Owner login
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gold-200">
              Philippine Peso (₱) ready · Mobile friendly
            </p>
            <h1 className="mt-6 font-display text-4xl leading-tight text-cream-50 sm:text-5xl">
              Find hidden profit leaks in your cafe or restaurant.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-cream-200/90">
              Upload your reports. Discover where money quietly walks out the door. Combine rule-based
              checks with AI explanations—without inventing numbers you did not upload.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/auth"
                className="inline-flex items-center justify-center rounded-full bg-gold-400 px-6 py-3 text-sm font-semibold text-navy-950 shadow-lg shadow-gold-400/25 hover:bg-gold-300"
              >
                Upload Reports
              </Link>
              <Link
                href="/guide"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-cream-50 hover:bg-white/5"
              >
                Read the guide
              </Link>
            </div>
            <p className="mt-6 text-sm text-cream-200/70">
              Main value proposition: upload sales, inventory, expenses, and staff files—get KPIs,
              charts, scanner results, and an AI action plan in minutes.
            </p>
          </div>

          <div className="glass relative overflow-hidden rounded-3xl p-6">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold-400/20 blur-3xl" />
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-300">Live preview</p>
            <p className="mt-2 font-display text-2xl text-cream-50">Executive audit cockpit</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {["Profit leak score", "Food cost %", "Labor vs sales", "Dead hours"].map((k) => (
                <div
                  key={k}
                  className="rounded-2xl border border-white/10 bg-navy-900/40 p-4 text-sm text-cream-100"
                >
                  <p className="text-cream-200/70">{k}</p>
                  <p className="mt-2 text-lg font-semibold text-gold-200">—</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-cream-200/60">
              Premium restaurant-tech styling: navy, cream, gold accents, and alert reds where it
              matters.
            </p>
          </div>
        </div>

        <section className="mt-20">
          <h2 className="font-display text-2xl text-cream-50 sm:text-3xl">What you unlock</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-soft backdrop-blur"
              >
                <p className="text-sm font-semibold text-gold-200">{b.title}</p>
                <p className="mt-2 text-sm text-cream-200/85">{b.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-10 text-center text-xs text-cream-200/60">
        Built for owners who want clarity—not another spreadsheet maze.
      </footer>
    </div>
  );
}
