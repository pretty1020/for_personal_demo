import OpenAI from "openai";
import { requireEnv } from "@/lib/env";
import type { ActionPlanPayload, AuditFinding, DashboardPayload } from "@/lib/types/audit";
import { newId } from "@/lib/newId";

const SYSTEM = `You are Smart AI Auditor for small cafes and restaurants in the Philippines.
Rules:
- NEVER invent numeric facts. Only interpret numbers provided in the user JSON.
- If a dataset is missing, say exactly which upload is missing and what the owner should upload.
- Output strict JSON only, matching the provided schema.
- Currency context: Philippine Peso (₱). Keep recommendations practical for small teams.
- Combine: acknowledge rule-based flags, add concise owner-facing explanations and next steps.`;

export async function runAiAudit(params: {
  dashboard: DashboardPayload;
  ruleFindings: AuditFinding[];
}): Promise<{ aiFindings: AuditFinding[]; actionPlan: ActionPlanPayload }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      aiFindings: [
        {
          id: newId("ai"),
          severity: "Low",
          category: "Sales",
          title: "AI insights disabled",
          detail:
            "Set OPENAI_API_KEY on the server to generate narrative findings and a 7-day action plan. Rule-based scanner results are still available.",
          estimatedImpactPhp: null,
          recommendedAction: "Add the key in Render (or .env.local) and run “Refresh AI audit”.",
          source: "ai",
        },
      ],
      actionPlan: emptyPlan("Add OPENAI_API_KEY to enable an AI-generated plan."),
    };
  }

  const client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

  const userPayload = {
    kpis: params.dashboard.kpis,
    chartsHeadline: {
      salesDays: params.dashboard.salesByDay.length,
      salesHours: params.dashboard.salesByHour.length,
      topRevenueItems: params.dashboard.topItemsRevenue.slice(0, 5),
      lowMarginItems: params.dashboard.lowMarginItems.slice(0, 5),
    },
    ruleFindings: params.ruleFindings.map((f) => ({
      title: f.title,
      severity: f.severity,
      category: f.category,
    })),
  };

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Analyze this JSON. Return JSON with shape:
{
  "aiFindings": [{"title","detail","severity":"High"|"Medium"|"Low","category":"Sales"|"Inventory"|"Labor"|"Expense"|"Menu","estimatedImpactPhp": number|null,"recommendedAction"}],
  "actionPlan": {
    "sevenDayPlan": [{"day":1-7,"focus":"string","tasks":["string"]}],
    "pricing": ["string"],
    "promos": ["string"],
    "staffing": ["string"],
    "inventory": ["string"],
    "menu": ["string"]
  }
}
Limit aiFindings to 6 items. Do not invent amounts; estimatedImpactPhp must be null unless you can justify from provided KPI numbers in text (prefer null if unsure).
DATA:\n${JSON.stringify(userPayload)}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed: {
    aiFindings?: Partial<AuditFinding>[];
    actionPlan?: Partial<ActionPlanPayload>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const aiFindings: AuditFinding[] = (parsed.aiFindings || []).map((f) => ({
    id: newId("ai"),
    severity: (f.severity as AuditFinding["severity"]) || "Low",
    category: (f.category as AuditFinding["category"]) || "Sales",
    title: String(f.title || "Insight"),
    detail: String(f.detail || ""),
    estimatedImpactPhp:
      typeof f.estimatedImpactPhp === "number" && Number.isFinite(f.estimatedImpactPhp)
        ? f.estimatedImpactPhp
        : null,
    recommendedAction: String(f.recommendedAction || "Review the metric and adjust operations."),
    source: "ai" as const,
  }));

  const ap = parsed.actionPlan || {};
  const actionPlan: ActionPlanPayload = {
    sevenDayPlan:
      (ap.sevenDayPlan as ActionPlanPayload["sevenDayPlan"])?.length === 7
        ? (ap.sevenDayPlan as ActionPlanPayload["sevenDayPlan"])
        : defaultSevenDay(),
    pricing: Array.isArray(ap.pricing) ? (ap.pricing as string[]) : [],
    promos: Array.isArray(ap.promos) ? (ap.promos as string[]) : [],
    staffing: Array.isArray(ap.staffing) ? (ap.staffing as string[]) : [],
    inventory: Array.isArray(ap.inventory) ? (ap.inventory as string[]) : [],
    menu: Array.isArray(ap.menu) ? (ap.menu as string[]) : [],
  };

  return { aiFindings, actionPlan };
}

function emptyPlan(note: string): ActionPlanPayload {
  return {
    sevenDayPlan: defaultSevenDay(note),
    pricing: [],
    promos: [],
    staffing: [],
    inventory: [],
    menu: [],
  };
}

function defaultSevenDay(note?: string): ActionPlanPayload["sevenDayPlan"] {
  const base = Array.from({ length: 7 }).map((_, i) => ({
    day: i + 1,
    focus: i === 0 ? "Baseline" : "Execute",
    tasks: note && i === 0 ? [note] : ["Review yesterday’s sales vs labor", "Log waste for top 3 SKUs"],
  }));
  return base;
}
