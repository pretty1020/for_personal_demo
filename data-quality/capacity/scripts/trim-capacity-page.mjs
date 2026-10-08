import fs from 'fs'

const path = new URL('../src/pages/AdvancedStaffingCapacityPlanPage.tsx', import.meta.url)
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/)

const simplifiedData = [
  `              {tab === 'data' ? (`,
  `                <div className="cap-data-tab">`,
  `                  <StaffingCapacityPlanDataTable rows={filtered} />`,
  `                </div>`,
  `              ) : null}`,
]

const out = [...lines.slice(0, 3230), ...lines.slice(3242, 3243), ...simplifiedData, ...lines.slice(4010)]

fs.writeFileSync(path, out.join('\n'))
console.log('lines before', lines.length, 'after', out.length)
