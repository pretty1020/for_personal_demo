/**
 * Shared portfolio anchors — call-center BPO scale (~165 production agents, ~$612k/mo revenue).
 * Used by financial sample, planner defaults, and staffing sample generators.
 */
export const PORTFOLIO_MONTHLY_REVENUE_TARGET = 612_000
export const PORTFOLIO_WEEKLY_REVENUE_TARGET = PORTFOLIO_MONTHLY_REVENUE_TARGET / 4.33
export const PORTFOLIO_REVENUE_PER_CONTACT = 4.65
/** Monthly contacts implied by revenue ÷ rate (voice / chat blended). */
export const PORTFOLIO_MONTHLY_CONTACT_VOLUME = Math.round(
  PORTFOLIO_MONTHLY_REVENUE_TARGET / PORTFOLIO_REVENUE_PER_CONTACT,
)
/** Blended offshore production agents across PH / IN / RO. */
export const PORTFOLIO_TOTAL_PRODUCTION_AGENTS = 165
/** Typical weekly billable revenue per production agent (USD). */
export const PORTFOLIO_WEEKLY_REVENUE_PER_AGENT = 850
/** Target fully-loaded labor per FTE / month (USD). */
export const PORTFOLIO_LABOR_COST_PER_FTE_MONTHLY = 2_750
/** Monthly cost ceiling (~78% of revenue — positive GM). */
export const PORTFOLIO_MONTHLY_COST_BUDGET = 478_000
