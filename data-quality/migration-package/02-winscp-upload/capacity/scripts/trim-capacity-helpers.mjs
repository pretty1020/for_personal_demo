import fs from 'fs'

const path = new URL('../src/pages/AdvancedStaffingCapacityPlanPage.tsx', import.meta.url)
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/)

function removeBlock(startPattern, endBeforePattern) {
  const start = lines.findIndex((l) => startPattern.test(l))
  const end = lines.findIndex((l) => endBeforePattern.test(l))
  if (start >= 0 && end > start) {
    lines.splice(start, end - start)
    return true
  }
  return false
}

removeBlock(/^const DEFAULT_WHATIF/, /^function downloadArrayBuffer/)
removeBlock(/^function fmtHc\(/, /^\*\* USD display/)
removeBlock(/^function fmtRateUsd\(/, /^\/\*\*/)
removeBlock(/^const MOVATE_SERIES/, /^function billingTypeFilterMatches/)
removeBlock(/^function CapChartLabelToggle/, /^function billingTypeFilterMatches/) // if still there
removeBlock(/^function CapChartLabelToggle/, /^function matchesFilter/)
removeBlock(/^function aggregateLeakageByWeek/, /^export function AdvancedStaffingCapacityPlanPage/)

// Clean imports - manual list in output
fs.writeFileSync(path, lines.join('\n'))
console.log('lines', lines.length)
