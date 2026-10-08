/** User-facing definitions for scheduling KPIs (FTE vs headcount). */



export const SCHEDULING_METRIC_TOOLTIPS = {

  requiredWeekTotal:

    'Weekly required FTE from Capacity (or manual input). Same units as scheduled FTE below. ' +

    'Formula: sum of daily required FTE across all calendar days in the week ÷ paid working days (e.g. 5). ' +

    'Daily FTE = sum of required interval headcounts across all intervals ÷ shift length ÷ (60 ÷ interval minutes).',

  scheduledHc:

    'Agents to schedule from Capacity — the full production headcount roster (e.g. 50 HC). ' +

    'Subtitle shows how many roster agents received at least one shift assignment in the week.',

  avgAgentsPerDay:

    'Average number of agents assigned a shift on each open day (after per-agent rest days). ' +

    'Peak requirement days receive more working agents via demand-balanced rest placement.',

  scheduledFteWeek:
    'Scheduled FTE for the week after lunch and breaks (net productive time).',

  dailyNetFte:

    'Net FTE (Daily) in the summary table — productive FTE after lunch and breaks. ' +

    'Formula: SUM(interval Net FTE for the day) ÷ shift length ÷ (60 ÷ interval minutes).',

  scheduledFteDaily:

    'Alias for Net FTE (Daily) in the summary table.',

  variance:

    'Scheduled FTE (net, week total) minus required week total FTE. Positive = overstaffed vs requirement.',

  staffingPct: 'Scheduled FTE (net, week total) ÷ required week total FTE × 100.',

  optimization:

    'Shift starts and lunch/break placement are optimized to minimize interval gaps vs requirements, ' +

    'with peak intervals and peak days weighted by the uploaded pattern. Rest days favor low-demand days.',

} as const

