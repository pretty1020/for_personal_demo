import fs from 'fs'

const path = new URL('../src/pages/AdvancedStaffingCapacityPlanPage.tsx', import.meta.url)
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/)

// Remove training/support headcount block (1-based 1009-1017)
lines.splice(1008, 9)

// After splice, line numbers shift. Find markers by content.
const idxForecastSlice = lines.findIndex((l) => l.includes('const forecastWeeklySlice'))
const idxOnUpload = lines.findIndex((l) => l.includes('const onUpload = useCallback'))
if (idxForecastSlice >= 0 && idxOnUpload > idxForecastSlice) {
  lines.splice(idxForecastSlice, idxOnUpload - idxForecastSlice)
}

// Remove SafeChart, WarIssue, WhatIfNum helper components at end
const idxSafeChart = lines.findIndex((l) => l.startsWith('function SafeChart'))
const idxEndFile = lines.length
if (idxSafeChart >= 0) {
  // Keep WeekOnWeekVarianceTable and anything before SafeChart
  lines = lines.slice(0, idxSafeChart)
}

// Remove unused state lines
const statePatterns = [
  /const \[whatIf, setWhatIf\]/,
  /const \[chartLabelFlags, setChartLabelFlags\]/,
  /const \[execChartsOpen, setExecChartsOpen\]/,
  /const \[execGran, setExecGran\]/,
  /const \[ratesLeakPeriod, setRatesLeakPeriod\]/,
  /const \[forecastHistoryWeeks, setForecastHistoryWeeks\]/,
  /const \[forecastFitModelId, setForecastFitModelId\]/,
]
lines = lines.filter((line) => !statePatterns.some((p) => p.test(line)))

// Remove locationFilter only line
lines = lines.filter((line) => !line.includes('const locationFilter = filters.location'))

// Remove avgEffectiveRatesByBillingType useMemo block
const idxAvg = lines.findIndex((l) => l.includes('const avgEffectiveRatesByBillingType'))
if (idxAvg >= 0) {
  let end = idxAvg + 1
  while (end < lines.length && !lines[end].startsWith('  const kpis')) end++
  lines.splice(idxAvg, end - idxAvg)
}

// Clean imports
const importRemovals = [
  "import { sumSupportRoles, sumTrainingPipeline } from '../utils/staffingCapacity/roleHeadcountAggregate'",
  "import { runForecastModels, type ForecastModelResult } from '../utils/staffingCapacity/forecastModels'",
  "import { simulateWhatIf, sumLeakage } from '../utils/staffingCapacity/whatIf'",
]
lines = lines.filter((line) => !importRemovals.some((r) => line.trim() === r))

// Update leakage hint in executiveKpiSections
const text = lines.join('\n')
  .replace(
    'hint: \'Component breakdown (HC, volume, shrinkage, attrition, AHT) is on the Rates & Leakage tab.\',',
    'hint: \'Sum of billing-model-aware leakage components for filtered rows.\',',
  )

fs.writeFileSync(path, text)
console.log('trimmed capacity page, lines:', text.split(/\r?\n/).length)
