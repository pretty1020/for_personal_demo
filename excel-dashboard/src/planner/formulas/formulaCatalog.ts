export type FormulaPageGroup = 'revenue' | 'capacity' | 'financial' | 'planning'

export type FormulaId =
  | 'revproj.productiveHours'
  | 'revproj.productiveHoursPostOcc'
  | 'revproj.requiredFte'
  | 'revproj.hourlyCapacityRevenue'
  | 'revproj.hourlyFteRevenue'
  | 'revproj.monthlyRevenue'
  | 'revproj.perMinuteCapacityRevenue'
  | 'revproj.perMinuteFteRevenue'
  | 'revproj.perTransactionCapacityRevenue'
  | 'revproj.perTransactionFteRevenue'
  | 'revproj.extraHoursRevenue'
  | 'revproj.revenueFactors'
  | 'revproj.discountRevenue'
  | 'revproj.laborCost'
  | 'revproj.totalCost'
  | 'revproj.grossMargin'
  | 'capacity.paidFte'
  | 'capacity.availableFte'
  | 'planning.productiveHoursPerFte'
  | 'financial.weeklyProductiveHours'
  | 'financial.weeksInMonth'
  | 'financial.weeklyHourlyRevenue'
  | 'financial.weeklyHourlyCapacityRevenue'
  | 'financial.weeklyMonthlyRevenue'
  | 'financial.weeklyPerMinuteRevenue'
  | 'financial.weeklyPerMinuteFteRevenue'
  | 'financial.weeklyPerTransactionRevenue'
  | 'financial.weeklyTransactionalRevenue'
  | 'financial.weeklyExtraHours'
  | 'financial.weeklyLaborCost'
  | 'financial.weeklyTrainingCost'
  | 'financial.weeklyTotalCost'
  | 'financial.leakageHeadcount'
  | 'financial.leakageOverstaffing'
  | 'financial.leakageShrinkage'
  | 'financial.leakageAht'
  | 'financial.leakageAttrition'
  | 'financial.leakageVolume'
  | 'financial.leakageTotal'

export type FormulaVariable = { name: string; label: string }

export type FormulaDefinition = {
  id: FormulaId
  group: FormulaPageGroup
  label: string
  description: string
  variables: FormulaVariable[]
  defaultExpression: string
}

export const FORMULA_GROUP_LABELS: Record<FormulaPageGroup, string> = {
  revenue: 'Revenue Projection',
  capacity: 'Capacity',
  financial: 'Financial Overview',
  planning: 'Planning Scenario',
}

export const FORMULA_CATALOG: readonly FormulaDefinition[] = [
  {
    id: 'revproj.productiveHours',
    group: 'revenue',
    label: 'Productive hours',
    description: 'Hours available after absenteeism and in office shrinkage.',
    variables: [
      { name: 'networkDays', label: 'Network days' },
      { name: 'loginHours', label: 'Login hours' },
      { name: 'absenteeismPct', label: 'Absenteeism %' },
      { name: 'shrinkagePct', label: 'In office Shrinkage %' },
    ],
    defaultExpression: 'networkDays * loginHours * max(0, 1 - absenteeismPct / 100 - shrinkagePct / 100)',
  },
  {
    id: 'revproj.productiveHoursPostOcc',
    group: 'revenue',
    label: 'Productive hours post occupancy',
    description: 'Productive hours after occupancy.',
    variables: [
      { name: 'productiveHours', label: 'Productive hours' },
      { name: 'occupancyPct', label: 'Occupancy %' },
    ],
    defaultExpression: 'productiveHours * (occupancyPct / 100)',
  },
  {
    id: 'revproj.requiredFte',
    group: 'revenue',
    label: 'Required FTE',
    description: 'Required FTE from handle hours and productive hours post occupancy.',
    variables: [
      { name: 'capacity', label: 'Capacity / transactions' },
      { name: 'aht', label: 'AHT seconds' },
      { name: 'productiveHoursPostOcc', label: 'Productive hours post occupancy' },
    ],
    defaultExpression: '(capacity * aht / 3600) / productiveHoursPostOcc',
  },
  {
    id: 'revproj.hourlyCapacityRevenue',
    group: 'revenue',
    label: 'Hourly revenue (capacity)',
    description:
      'Convert capacity to billed hours, then × hourly rate. Billed hours = Capacity × (AHT ÷ 3600). Weekly Overview uses the same math with that week’s volume.',
    variables: [
      { name: 'capacity', label: 'Capacity / weekly volume' },
      { name: 'aht', label: 'AHT seconds' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
      { name: 'loginHours', label: 'Login hours' },
      { name: 'shrinkagePct', label: 'In office Shrinkage %' },
    ],
    defaultExpression: 'capacity * (aht / 3600) * hourlyBillRate',
  },
  {
    id: 'revproj.hourlyFteRevenue',
    group: 'revenue',
    label: 'Hourly revenue (FTE billing)',
    description:
      'Convert Production FTE to billed hours, then × hourly rate. Used for FTE billing and Production Hours when FTE is entered. Weekly Overview uses 5 network days so 19 FTE bills more than 7 FTE at the same hourly rate.',
    variables: [
      { name: 'fte', label: 'FTE' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
      { name: 'productiveHours', label: 'Productive hours' },
      { name: 'networkDays', label: 'Network days' },
      { name: 'loginHours', label: 'Login hours' },
    ],
    defaultExpression: 'fte * hourlyBillRate * productiveHours',
  },
  {
    id: 'revproj.monthlyRevenue',
    group: 'revenue',
    label: 'Monthly bill revenue',
    description: 'FTE or required FTE × monthly rate.',
    variables: [
      { name: 'fte', label: 'FTE' },
      { name: 'requiredFte', label: 'Required FTE' },
      { name: 'monthlyBillRate', label: 'Monthly bill rate' },
    ],
    defaultExpression: 'fte * monthlyBillRate',
  },
  {
    id: 'revproj.perMinuteCapacityRevenue',
    group: 'revenue',
    label: 'Per-minute revenue (capacity)',
    description: 'Capacity × (AHT / 60) × per-minute rate.',
    variables: [
      { name: 'capacity', label: 'Capacity' },
      { name: 'aht', label: 'AHT seconds' },
      { name: 'perMinuteBillRate', label: 'Per-minute bill rate' },
    ],
    defaultExpression: 'capacity * (aht / 60) * perMinuteBillRate',
  },
  {
    id: 'revproj.perMinuteFteRevenue',
    group: 'revenue',
    label: 'Per-minute revenue (FTE billing)',
    description: 'FTE × productive hours × 60 × per-minute rate.',
    variables: [
      { name: 'fte', label: 'FTE' },
      { name: 'productiveHours', label: 'Productive hours' },
      { name: 'perMinuteBillRate', label: 'Per-minute bill rate' },
    ],
    defaultExpression: 'fte * productiveHours * 60 * perMinuteBillRate',
  },
  {
    id: 'revproj.perTransactionCapacityRevenue',
    group: 'revenue',
    label: 'Per chat / sale / transaction revenue (capacity)',
    description: 'Each chat, sale, or transaction billed at a flat unit rate. Capacity is the unit count — AHT is not used.',
    variables: [
      { name: 'capacity', label: 'Capacity / transactions' },
      { name: 'perTransactionBillRate', label: 'Per chat / sale / transaction bill rate' },
    ],
    defaultExpression: 'capacity * perTransactionBillRate',
  },
  {
    id: 'revproj.perTransactionFteRevenue',
    group: 'revenue',
    label: 'Per chat / sale / transaction revenue (FTE billing)',
    description: 'FTE billing still bills units, not heads: Capacity / transactions × unit rate. Does not substitute FTE × rate.',
    variables: [
      { name: 'capacity', label: 'Capacity / transactions' },
      { name: 'fte', label: 'FTE' },
      { name: 'perTransactionBillRate', label: 'Per chat / sale / transaction bill rate' },
    ],
    defaultExpression: 'capacity * perTransactionBillRate',
  },
  {
    id: 'revproj.extraHoursRevenue',
    group: 'revenue',
    label: 'Extra hours revenue',
    description: 'Extra hours billed at the primary time-based rate. Not converted into chats, sales, or transactions.',
    variables: [
      { name: 'extraHours', label: 'Extra hours' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
      { name: 'perMinuteBillRate', label: 'Per-minute bill rate' },
      { name: 'monthlyBillRate', label: 'Monthly bill rate' },
      { name: 'networkDays', label: 'Network days' },
      { name: 'loginHours', label: 'Login hours' },
    ],
    defaultExpression: 'extraHours * hourlyBillRate',
  },
  {
    id: 'revproj.revenueFactors',
    group: 'revenue',
    label: 'Factors affecting revenue',
    description:
      'Optional named ± factors after billed methods and extra hours. All percent factors are summed, then all dollar factors are added. Positive increases Total Revenue; negative decreases it.',
    variables: [
      { name: 'billedRevenue', label: 'Billed revenue (methods + extra hours)' },
      { name: 'revenueFactorPct', label: 'Revenue factor ± %' },
      { name: 'revenueAdjustmentUsd', label: 'Revenue adjustment ± $' },
    ],
    defaultExpression: 'billedRevenue * (1 + revenueFactorPct / 100) + revenueAdjustmentUsd',
  },
  {
    id: 'revproj.discountRevenue',
    group: 'revenue',
    label: 'Discount or less to revenue',
    description: 'Subtract the discount from factored revenue. Result is floored at 0.',
    variables: [
      { name: 'factoredRevenue', label: 'Revenue after ± factors' },
      { name: 'discountOrLessToRevenue', label: 'Discount or less to revenue' },
      { name: 'billedRevenue', label: 'Billed revenue before factors' },
    ],
    defaultExpression: 'max(0, factoredRevenue - discountOrLessToRevenue)',
  },
  {
    id: 'revproj.laborCost',
    group: 'revenue',
    label: 'Labor cost',
    description: 'Monthly labor / FTE, or FTE × productive hours × hourly salary.',
    variables: [
      { name: 'fteForCost', label: 'FTE used for cost' },
      { name: 'productiveHours', label: 'Productive hours' },
      { name: 'hourlySalaryUsd', label: 'Hourly salary' },
      { name: 'monthlyLaborPerFteUsd', label: 'Monthly labor / FTE' },
    ],
    defaultExpression: 'fteForCost * productiveHours * hourlySalaryUsd',
  },
  {
    id: 'revproj.totalCost',
    group: 'revenue',
    label: 'Total cost',
    description:
      'Labor plus support, training, other costs, and custom cost-detail lines scaled by working weeks.',
    variables: [
      { name: 'laborCost', label: 'Labor cost' },
      { name: 'supportSalaryUsd', label: 'Support salary / week' },
      { name: 'trainingSalaryRateUsd', label: 'Training salary / HC / week' },
      { name: 'otherCostUsd', label: 'Other cost / week' },
      { name: 'extraSalaryCost', label: 'Salary-like cost lines (month)' },
      { name: 'extraOpexCost', label: 'Other category cost lines (month)' },
      { name: 'weeksInMonth', label: 'Working weeks in month' },
      { name: 'fteForCost', label: 'FTE used for cost' },
    ],
    defaultExpression:
      'laborCost + supportSalaryUsd * weeksInMonth + trainingSalaryRateUsd * fteForCost * weeksInMonth + otherCostUsd * weeksInMonth + extraSalaryCost + extraOpexCost',
  },
  {
    id: 'revproj.grossMargin',
    group: 'revenue',
    label: 'Gross margin',
    description: 'Revenue minus cost.',
    variables: [
      { name: 'totalRevenue', label: 'Total revenue' },
      { name: 'totalCost', label: 'Total cost' },
    ],
    defaultExpression: 'totalRevenue - totalCost',
  },
  {
    id: 'capacity.paidFte',
    group: 'capacity',
    label: 'Paid FTE',
    description: 'Paid FTE = Required Production FTE ÷ (1 − Shrinkage).',
    variables: [
      { name: 'requiredProductionFte', label: 'Required Production FTE' },
      { name: 'shrinkage', label: 'Shrinkage rate 0–1' },
    ],
    defaultExpression: 'requiredProductionFte / (1 - shrinkage)',
  },
  {
    id: 'capacity.availableFte',
    group: 'capacity',
    label: 'Available FTE after shrink',
    description: 'Production HC × (1 − shrinkage).',
    variables: [
      { name: 'productionHc', label: 'Production HC' },
      { name: 'shrinkage', label: 'Shrinkage rate 0–1' },
    ],
    defaultExpression: 'productionHc * (1 - shrinkage)',
  },
  {
    id: 'planning.productiveHoursPerFte',
    group: 'planning',
    label: 'Productive hours / FTE / week',
    description: 'Scheduled hours reduced by shrinkage.',
    variables: [
      { name: 'standardScheduledHoursPerWeek', label: 'Scheduled hours / FTE / week' },
      { name: 'shrinkageRate', label: 'Shrinkage rate 0–1' },
    ],
    defaultExpression: 'standardScheduledHoursPerWeek * (1 - shrinkageRate)',
  },
  {
    id: 'financial.weeklyProductiveHours',
    group: 'financial',
    label: 'Weekly productive hours (per FTE)',
    description:
      'Same identity as Revenue Projection productive hours, for one week: 5 network days × login hours × (1 − absenteeism − in-office shrinkage). Monthly productive hours use calendar network days instead of 5. Week × (network days ÷ 5) = month.',
    variables: [
      { name: 'networkDays', label: 'Network days (5 for a week)' },
      { name: 'loginHours', label: 'Login hours' },
      { name: 'absenteeismPct', label: 'Absenteeism %' },
      { name: 'shrinkagePct', label: 'In office Shrinkage %' },
    ],
    defaultExpression: 'networkDays * loginHours * max(0, 1 - absenteeismPct / 100 - shrinkagePct / 100)',
  },
  {
    id: 'financial.weeksInMonth',
    group: 'financial',
    label: 'Working weeks in month',
    description:
      'Converts a calendar month to weeks so weekly Overview sums to that month on Revenue Projection. Network days ÷ 5 (Mon–Fri). A week counts in the month that contains more of its 7 days (week of 30 Aug → September; week of 29 Nov → December).',
    variables: [{ name: 'networkDays', label: 'Network days in the calendar month' }],
    defaultExpression: 'networkDays / 5',
  },
  {
    id: 'financial.weeklyHourlyRevenue',
    group: 'financial',
    label: 'Weekly hourly revenue (Production Hours / FTE)',
    description:
      'Production Hours and FTE billing: Production FTE × hours × hourly bill rate. Example $24: 19 FTE × weekly productive hours × 24 is larger than 7 FTE × the same hours × 24.',
    variables: [
      { name: 'productionFte', label: 'Production FTE' },
      { name: 'productiveHours', label: 'Weekly productive hours / FTE' },
      { name: 'hours', label: 'Hours (same as productive hours)' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
    ],
    defaultExpression: 'productionFte * productiveHours * hourlyBillRate',
  },
  {
    id: 'financial.weeklyHourlyCapacityRevenue',
    group: 'financial',
    label: 'Weekly hourly revenue (capacity)',
    description:
      'Transactional hourly path: convert volume to hours, then × hourly rate. Example $24: volume × (AHT ÷ 3600) × 24. Production Hours and FTE billing use financial.weeklyHourlyRevenue (Production FTE × hours × rate) instead.',
    variables: [
      { name: 'volume', label: 'Weekly volume / capacity' },
      { name: 'ahtSeconds', label: 'AHT seconds' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
    ],
    defaultExpression: 'volume * (ahtSeconds / 3600) * hourlyBillRate',
  },
  {
    id: 'financial.weeklyMonthlyRevenue',
    group: 'financial',
    label: 'Weekly monthly-rate revenue',
    description:
      'Monthly bill ÷ working weeks in that calendar month. FTE billing uses Production HC/FTE; capacity path uses required FTE. Week × (network days ÷ 5) = the Revenue Projection month.',
    variables: [
      { name: 'productionHc', label: 'Billed FTE / HC' },
      { name: 'monthlyBillRate', label: 'Monthly bill rate' },
      { name: 'weeksPerMonth', label: 'Weeks in month (network days ÷ 5)' },
    ],
    defaultExpression: 'productionHc * (monthlyBillRate / weeksPerMonth)',
  },
  {
    id: 'financial.weeklyPerMinuteRevenue',
    group: 'financial',
    label: 'Weekly per-minute revenue (capacity)',
    description:
      'Volume × (AHT ÷ 60) × per-minute rate. Same as revproj.perMinuteCapacityRevenue with weekly volume. Missing volume or AHT is 0.',
    variables: [
      { name: 'volume', label: 'Volume' },
      { name: 'ahtSeconds', label: 'AHT seconds' },
      { name: 'perMinuteBillRate', label: 'Per-minute bill rate' },
      { name: 'productionFte', label: 'Production FTE' },
      { name: 'hours', label: 'Weekly productive hours' },
    ],
    defaultExpression: 'volume * (ahtSeconds / 60) * perMinuteBillRate',
  },
  {
    id: 'financial.weeklyPerMinuteFteRevenue',
    group: 'financial',
    label: 'Weekly per-minute revenue (FTE billing)',
    description:
      'Convert FTE to minutes, then × per-minute rate: Production FTE × weekly productive hours × 60 × rate. Matches revproj.perMinuteFteRevenue.',
    variables: [
      { name: 'productionFte', label: 'Production FTE' },
      { name: 'productiveHours', label: 'Weekly productive hours / FTE' },
      { name: 'perMinuteBillRate', label: 'Per-minute bill rate' },
    ],
    defaultExpression: 'productionFte * productiveHours * 60 * perMinuteBillRate',
  },
  {
    id: 'financial.weeklyPerTransactionRevenue',
    group: 'financial',
    label: 'Weekly per chat / sale / transaction revenue',
    description: 'Volume × unit rate. AHT is not used and hours are not substituted. Same as the Revenue Projection per-transaction formulas.',
    variables: [
      { name: 'volume', label: 'Volume' },
      { name: 'perTransactionBillRate', label: 'Per chat / sale / transaction bill rate' },
    ],
    defaultExpression: 'volume * perTransactionBillRate',
  },
  {
    id: 'financial.weeklyTransactionalRevenue',
    group: 'financial',
    label: 'Weekly transactional hourly revenue',
    description: 'Alias of capacity hourly: volume × (AHT ÷ 3600) × hourly rate.',
    variables: [
      { name: 'volume', label: 'Volume' },
      { name: 'ahtSeconds', label: 'AHT seconds' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
    ],
    defaultExpression: 'volume * (ahtSeconds / 3600) * hourlyBillRate',
  },
  {
    id: 'financial.weeklyExtraHours',
    group: 'financial',
    label: 'Weekly extra hours revenue',
    description:
      'Revenue Projection extra hours for the month, spread across working weeks, billed at the primary time-based rate. Hourly: extra hours × hourly rate.',
    variables: [
      { name: 'extraHours', label: 'Extra hours this week' },
      { name: 'hourlyBillRate', label: 'Hourly bill rate' },
      { name: 'perMinuteBillRate', label: 'Per-minute bill rate' },
      { name: 'monthlyBillRate', label: 'Monthly bill rate' },
      { name: 'loginHours', label: 'Login hours' },
    ],
    defaultExpression: 'extraHours * hourlyBillRate',
  },
  {
    id: 'financial.weeklyLaborCost',
    group: 'financial',
    label: 'Weekly production labor',
    description:
      'Same hours as weekly FTE revenue: Production FTE × weekly productive hours × hourly salary. If monthly labor / FTE is set, week = FTE × (monthly labor ÷ weeks in month) so the month matches Revenue Projection.',
    variables: [
      { name: 'productionFte', label: 'Production FTE' },
      { name: 'productiveHours', label: 'Weekly productive hours / FTE' },
      { name: 'standardHoursPerWeek', label: 'Hours (same as productive hours)' },
      { name: 'hourlySalaryUsd', label: 'Hourly salary' },
      { name: 'monthlyLaborPerFteUsd', label: 'Monthly labor / FTE' },
      { name: 'weeksInMonth', label: 'Weeks in month' },
    ],
    defaultExpression: 'productionFte * productiveHours * hourlySalaryUsd',
  },
  {
    id: 'financial.weeklyTrainingCost',
    group: 'financial',
    label: 'Weekly training pipeline cost',
    description: '(Training HC + Nesting HC) × training salary rate.',
    variables: [
      { name: 'trainingHc', label: 'Training HC' },
      { name: 'nestingHc', label: 'Nesting HC' },
      { name: 'trainingSalaryRateUsd', label: 'Training salary rate' },
    ],
    defaultExpression: '(trainingHc + nestingHc) * trainingSalaryRateUsd',
  },
  {
    id: 'financial.weeklyTotalCost',
    group: 'financial',
    label: 'Weekly total cost',
    description: 'Labor + training + support + other + custom cost-detail lines.',
    variables: [
      { name: 'labor', label: 'Production labor' },
      { name: 'training', label: 'Training pipeline' },
      { name: 'supportSalaryUsd', label: 'Support salary / week' },
      { name: 'otherCostUsd', label: 'Other cost / week' },
      { name: 'extraSalaryUsd', label: 'Salary-like cost lines / week' },
      { name: 'extraOpexUsd', label: 'Other category cost lines / week' },
    ],
    defaultExpression: 'labor + training + supportSalaryUsd + otherCostUsd + extraSalaryUsd + extraOpexUsd',
  },
  {
    id: 'financial.leakageHeadcount',
    group: 'financial',
    label: 'Revenue leakage — understaffing',
    description:
      'Production HC below the plan (understaffing), priced at this LOB’s bill rate. Transactional uses throughput × rate; monthly FTE uses weekly FTE rate; per-minute uses hours × 60 × rate; hourly uses hours × rate.',
    variables: [
      { name: 'hcGap', label: 'Planned HC − actual HC (floor 0)' },
      { name: 'fteGap', label: 'Planned FTE − actual FTE (floor 0)' },
      { name: 'hours', label: 'Standard hours / week' },
      { name: 'billingRate', label: 'Active bill rate' },
      { name: 'throughput', label: 'Handled volume / actual HC' },
      { name: 'lostHeadRevenue', label: 'Weekly revenue of one lost head' },
    ],
    defaultExpression: 'hcGap * lostHeadRevenue',
  },
  {
    id: 'financial.leakageOverstaffing',
    group: 'financial',
    label: 'Revenue leakage — overstaffing',
    description:
      'Actual production HC above the plan (overstaffing). Priced like understaffing at the LOB bill rate for excess paid capacity that was not required by the plan.',
    variables: [
      { name: 'overstaffHcGap', label: 'Actual HC − planned HC (floor 0)' },
      { name: 'overstaffFteGap', label: 'Actual FTE − planned FTE (floor 0)' },
      { name: 'hours', label: 'Standard hours / week' },
      { name: 'billingRate', label: 'Active bill rate' },
      { name: 'throughput', label: 'Handled volume / actual HC' },
      { name: 'lostHeadRevenue', label: 'Weekly revenue of one head' },
    ],
    defaultExpression: 'overstaffHcGap * lostHeadRevenue',
  },
  {
    id: 'financial.leakageShrinkage',
    group: 'financial',
    label: 'Revenue leakage — non-billable shrinkages',
    description:
      'Non-billable shrinkage above plan (out-of-office plus non-billable in-office). Gap is a fraction of time × this week’s billed production base.',
    variables: [
      { name: 'nbShrinkGap', label: 'Non-billable shrink overrun (0–1)' },
      { name: 'shrinkBaseRevenue', label: 'Weekly billed production base' },
      { name: 'hours', label: 'Standard hours / week' },
      { name: 'billingRate', label: 'Active bill rate' },
    ],
    defaultExpression: 'nbShrinkGap * shrinkBaseRevenue',
  },
  {
    id: 'financial.leakageAht',
    group: 'financial',
    label: 'Revenue leakage — AHT',
    description:
      'AHT above plan on handled contacts. Per-minute billing is 0 (longer handle bills more). Transactional prices lost equivalent units; hourly prices extra handle hours at the hourly rate; monthly FTE converts extra hours to the weekly FTE rate.',
    variables: [
      { name: 'ahtGapSec', label: 'Actual AHT − planned AHT (seconds, floor 0)' },
      { name: 'actualHandled', label: 'Actual handled volume' },
      { name: 'actualAht', label: 'Actual AHT seconds' },
      { name: 'plannedAht', label: 'Planned AHT seconds' },
      { name: 'billingRate', label: 'Active bill rate' },
      { name: 'hours', label: 'Standard hours / week' },
      { name: 'ahtLeakage', label: 'Model-priced AHT leakage' },
    ],
    defaultExpression: 'ahtLeakage',
  },
  {
    id: 'financial.leakageAttrition',
    group: 'financial',
    label: 'Revenue leakage — attrition',
    description: 'Actual attrition heads above the planned leavers, priced like a lost production head.',
    variables: [
      { name: 'attritionGap', label: 'Actual attrition − planned attrition (floor 0)' },
      { name: 'lostHeadRevenue', label: 'Weekly revenue of one lost head' },
    ],
    defaultExpression: 'attritionGap * lostHeadRevenue',
  },
  {
    id: 'financial.leakageVolume',
    group: 'financial',
    label: 'Revenue leakage — volume shortfall',
    description:
      'Handled (transactional) or offered (hours / FTE) volume below plan. Transactional: missed units × rate. Per-minute: missed units × planned minutes × rate. Hourly: missed units × planned hours × rate. Monthly FTE: missed share of planned weekly FTE revenue.',
    variables: [
      { name: 'volumeGap', label: 'Planned volume − actual volume (floor 0)' },
      { name: 'plannedVolume', label: 'Planned volume' },
      { name: 'plannedAht', label: 'Planned AHT seconds' },
      { name: 'billingRate', label: 'Active bill rate' },
      { name: 'volumeUnitRevenue', label: 'Revenue per missed unit' },
    ],
    defaultExpression: 'volumeGap * volumeUnitRevenue',
  },
  {
    id: 'financial.leakageTotal',
    group: 'financial',
    label: 'Revenue leakage — total',
    description:
      'Sum of understaffing, overstaffing, non-billable shrinkages, AHT, attrition, and volume for the period.',
    variables: [
      { name: 'headcount', label: 'Understaffing leakage' },
      { name: 'overstaffing', label: 'Overstaffing leakage' },
      { name: 'shrinkage', label: 'Non-billable shrinkage leakage' },
      { name: 'aht', label: 'AHT leakage' },
      { name: 'attrition', label: 'Attrition leakage' },
      { name: 'volume', label: 'Volume shortfall leakage' },
    ],
    defaultExpression: 'headcount + overstaffing + shrinkage + aht + attrition + volume',
  },
]

export function getFormulaDefinition(id: FormulaId): FormulaDefinition | undefined {
  return FORMULA_CATALOG.find((item) => item.id === id)
}
