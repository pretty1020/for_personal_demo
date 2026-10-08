/** Human-readable formulas aligned with `AdvancedStaffingCapacityPlanPage` aggregations, `enrichStaffingRow`, and `billingModel.ts` (UI reference). */

export type FormulaSectionId =
  | 'portfolio'
  | 'period_agg'
  | 'availability_fte'
  | 'attrition_hc'
  | 'matrix_ou'
  | 'shrink_matrix_optional'
  | 'billing'
  | 'leakage_fte'
  | 'leakage_txn'
  | 'leakage_minute'
  | 'forecast'
  | 'whatif'

export type FormulaSection = {
  id: FormulaSectionId
  title: string
  summary: string
  lines: string[]
}

export const FORMULA_SECTIONS: FormulaSection[] = [
  {
    id: 'portfolio',
    title: 'Capacity Plan — portfolio KPIs',
    summary:
      'All KPIs use the filtered enriched row set. Missing numeric inputs show as — (no synthetic defaults). Executive cards use the same filters as the matrix and charts.',
    lines: [
      'Avg Required HC = arithmetic mean of Required Headcount (mapped `requiredHc`) over filtered rows with a finite value; exact 0 is excluded as a non-contributing cell.',
      'Avg Active Production HC / FTE = same rule: finite values only, exact 0 excluded.',
      'HC gap (Avg Act − Avg Req) = difference of those two means.',
      'Training HC / Support HC = sum of upload column values only (not inferred from pipeline or support-role totals).',
      'HTF = (Σ Actual Handled Volume) ÷ (Σ Forecast Volume) × 100 when forecast sum > 0; OTF and HTO use the same portfolio-sum pattern.',
      'Volume gap (Fcst − Hnd) = Σ (Forecast Volume − Actual Handled Volume) per row.',
      'Revenue leakage (total) = Σ Row Total Revenue Leakage after enrichment.',
      'Executive attrition cards use the same Σ(attrition) ÷ Σ(Active Production HC) × 100 rule over the filtered portfolio (not the legacy row-average attrition numbers).',
    ],
  },
  {
    id: 'period_agg',
    title: 'Weekly, monthly, and quarterly buckets',
    summary:
      'The capacity matrix and executive chart toggle use the same rollups. Rates & Leakage stacked leakage chart switches week / month / quarter independently.',
    lines: [
      'Weekly: group rows by Week Start Date.',
      'Monthly: FY · Month; column order follows first-seen order in the filtered portfolio.',
      'Quarterly: FY · Q1–Q4 from row Month or dominant calendar month of the week (calendar quarter).',
      'Within a bucket, Required HC, Active Production HC, FTE, volumes, role counts, and hour fields are summed where the source field is finite.',
      'Shrinkage / attrition / AHT shown as “period average” use the simple mean of row-level values in that bucket; exact 0 samples are excluded from those means (same rule as executive portfolio averages).',
      'Paid and training hours: period value = sum of mapped hours in-bucket; — if no row contributed a finite value (N = 0).',
      'Training HC and support HC in the matrix come from summed mapped upload columns and appear under Training pipeline and Support roles (not repeated in the main Headcount block).',
    ],
  },
  {
    id: 'availability_fte',
    title: 'Available FTE (matrix nested block)',
    summary:
      'Only rows with finite Active Production HC and a resolved shrink fraction contribute. Availability % rows were removed from the matrix; FTE after shrink remains in the Headcount block.',
    lines: [
      'Planned shrink fraction: column value; if > 1 it is treated as percent and divided by 100.',
      'Available FTE (planned) = Σ (Active Production HC × (1 − planned shrink fraction)) over contributing rows — HC-equivalent after planned shrink.',
      'Available FTE (actual) = Σ (Active Production HC × (1 − actual shrink fraction)) over contributing rows.',
    ],
  },
  {
    id: 'attrition_hc',
    title: 'Attrition vs active production HC (matrix)',
    summary:
      'Production attrition: headcount sums and % vs Σ Active Production HC. Training attrition (optional columns): sums and % vs Σ Training HC.',
    lines: [
      'Period Σ Active Production HC = sum of Active Production HC across all rows in the bucket (same as “Active production headcount” row).',
      'Planned Attrition Headcount (production) = Σ Planned Attrition over rows with a finite value in that column.',
      'Actual Attrition Headcount (production) = Σ Actual Attrition over rows with a finite value.',
      'Planned attrition / Active HC (%) = (Σ Planned Attrition over rows with finite planned attrition) ÷ (Σ Active Production HC) × 100 when both Σ planned attrition has at least one contributing row and Σ Active HC > 0; otherwise —.',
      'Actual attrition / Active HC (%) = (Σ Actual Attrition over rows with finite actual attrition) ÷ (Σ Active Production HC) × 100 under the same rules.',
      'When “Planned Training Attrition” / “Actual Training Attrition” columns are mapped: headcount rows are Σ of those fields; Planned/Actual Attrition % (training base) = Σ respective training attrition ÷ (Σ Training HC in bucket) × 100 when Σ Training HC > 0 and the numerator has at least one contributing row; otherwise —.',
      'Interpretation depends on how attrition columns are encoded in the upload (e.g. exit counts vs. rate). The formula follows the column semantics: sum of attrition values over the bucket divided by the stated denominator HC.',
    ],
  },
  {
    id: 'matrix_ou',
    title: 'WOW matrix — OU heatmap (shrink, volume, AHT)',
    summary:
      'Shrinkage and AHT Over–Under pairs use the same red / green / neutral logic as executive KPI cards. Volume uses the matrix “target direction” control.',
    lines: [
      'Shrinkage & AHT: each OU cell is paired with its OU % row. Red only when both that period’s OU and OU % are under target (OU < 0 and OU % < 100). Green when either beats target (OU > 0 or OU % > 100). Otherwise neutral.',
      'Volume: OU and OU % rows follow the selected target (lower vs higher actual better); shading reflects signed gaps and coverage vs plan (separate from shrink/AHT heatmap).',
      'Weekly buckets use Week Start Date. Monthly = FY · month rollups in first-seen order. Quarterly = FY · calendar quarter from row month / week.',
      'Production attrition % (matrix) = Σ(production attrition headcount) ÷ Σ(Active Production HC) × 100 when denominators and numerators are valid; training attrition % uses Σ(training attrition headcount) ÷ Σ(Training HC) × 100 when those columns are mapped.',
      'Planned vs actual attrition headcount comparison cells: red when actual Σ exceeds planned Σ for that pair; green otherwise.',
      'Shrinkage revenue leakage (Rates & Leakage) uses only the non-billable shrink gap (out-of-office shrink plus non-billable share of in-office shrink), not raw total shrink overrun — see leakage sections below.',
    ],
  },
  {
    id: 'shrink_matrix_optional',
    title: 'Matrix — optional shrinkage breakdown rows',
    summary:
      'Expandable in-office / out-of-office rows show planned vs actual and OU from upload-mapped totals. Nested line items are illustrative splits only.',
    lines: [
      'In-office vs out-of-office actual and planned rows use mapped shrink columns when present; defaults apply only where the upload does not split office vs off-site.',
      'Optional nested rows (e.g. meeting, coaching, PTO) apply fixed illustrative weights to the parent in-office or out-of-office actual for display; they are not separate AUX codes from the file.',
    ],
  },
  {
    id: 'billing',
    title: 'Billing model and effective rate',
    summary: 'Billing type text is classified as FTE/hours, transactional, or per-minute. Rate resolution prefers row Billing Rate, else matched rate card.',
    lines: [
      'Effective rate = Billing Rate (row) if set and > 0; else matched Rate sheet value.',
      'Production hours / head (h): if Production Hours ≤ 300 → use as hours per agent in period; if larger → treat as team total ÷ Active Production HC; else fallback = Days × 7.5 (defaults 21 × 7.5).',
      'Throughput / head (transactional) = Actual Handled Volume ÷ Active Production HC (fallback 1 if HC missing).',
    ],
  },
  {
    id: 'leakage_fte',
    title: 'Revenue leakage — FTE / production hour model',
    summary: 'Default when billing type reads as FTE, hourly, production hour, etc.',
    lines: [
      'HC leakage = max(Required HC − Active HC, 0) × h × Effective rate',
      'Volume leakage = max(Forecast Volume − Handled Volume, 0) × Effective rate',
      'Shrinkage leakage uses only the **non-billable shrink gap** (not total shrink % overrun): planned vs actual “non-billable shrink fraction” = (out-of-office shrink) + (in-office shrink × in-office non-billable share). Out-of-office shrink (PTO, absence, off-site) is treated as fully non-billable. In-office shrink is split using optional upload columns for in vs out of office; when missing, total shrink is split 62% in-office / 38% out-of-office before applying the non-billable share on in-office (default 58%). Leakage = max(actual_NB − planned_NB, 0) × FTE_for_shrink × h × Effective rate (or transactional throughput variant), same as before.',
      'Attrition leakage = max(Actual attrition − Planned attrition, 0) × h × Effective rate (heads × $/hour bucket).',
      'AHT leakage = max(Actual AHT − Planned AHT, 0) × (Handled Volume × Effective rate / 3600) proxy for hour impact.',
      'Total leakage = sum of non-null components above.',
    ],
  },
  {
    id: 'leakage_txn',
    title: 'Revenue leakage — transactional model',
    summary: 'When billing type matches transactional / per-transaction / unit bill.',
    lines: [
      'HC leakage = HC gap × Throughput/head × Effective rate ($/transaction).',
      'Volume leakage = max(Forecast − Handled, 0) × Effective rate.',
      'Shrinkage leakage uses the same **non-billable shrink gap** as the FTE model: max(actual_NB − planned_NB, 0) × Active HC × Throughput/head × Effective rate.',
      'Attrition leakage = attrition overrun (heads) × Throughput/head × Effective rate.',
      'AHT leakage = (AHT overrun seconds ÷ 3600) × Handled Volume × Effective rate.',
    ],
  },
  {
    id: 'leakage_minute',
    title: 'Revenue leakage — per-minute model',
    summary: 'When billing type matches per-minute / PPM / CPM style.',
    lines: [
      'HC / shrink / attrition branches use the same hour-based structure as FTE/hour (h × rate on heads or FTE).',
      'AHT leakage = (AHT overrun seconds ÷ 60) × Handled Volume × Effective rate (minutes of handle × $/minute).',
    ],
  },
  {
    id: 'forecast',
    title: 'Forecast tab (handled volume)',
    summary: 'Weekly handled volume is aggregated after filters; models run on that series.',
    lines: [
      'Naïve: next step = last actual.',
      'Moving average / SES / OLS trend: standard textbook recursions on the series.',
      'MAE = mean(|actual − fitted|), RMSE = sqrt(mean((actual − fitted)²)), MAPE = mean(|error|/|actual|)×100 where actual ≠ 0.',
    ],
  },
  {
    id: 'whatif',
    title: 'What-if simulator',
    summary: 'Clones filtered rows, applies deltas, then re-runs enrichment and leakage sum.',
    lines: [
      'HC add: distributed to shortage rows by gap weight, else spread evenly.',
      'Shrinkage: reduces actual shrink fraction toward planned floor.',
      'AHT / attrition / volume: subtract or add per row with optional distribution by weights.',
      'Rate multiplier: scales row Billing Rate if set, else matched Rate.',
    ],
  },
]

export const FORMULA_NOTES_STORAGE_KEY = 'staffing-capacity-plan-formula-notes'
