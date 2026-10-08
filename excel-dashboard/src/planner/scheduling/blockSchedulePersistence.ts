import type { WeekDayKey } from './schedulingSettingsTypes'

export type BlockSchedule = {
  id: string
  name: string
  supervisor: string
  startMinutes: number
  durationHours: number
  workingDays: WeekDayKey[]
  notes?: string
  updatedAt: string
}

export type BlockScheduleStore = {
  scenarioId: string
  blocks: BlockSchedule[]
}

export const BLOCK_SCHEDULE_STORAGE_KEY = 'wfp-scheduling-blocks-v1'

function loadAll(): Record<string, BlockScheduleStore> {
  try {
    const raw = localStorage.getItem(BLOCK_SCHEDULE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, BlockScheduleStore>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveAll(store: Record<string, BlockScheduleStore>): void {
  localStorage.setItem(BLOCK_SCHEDULE_STORAGE_KEY, JSON.stringify(store))
}

export function listBlockSchedules(scenarioId: string): BlockSchedule[] {
  return loadAll()[scenarioId]?.blocks ?? []
}

export function upsertBlockSchedule(scenarioId: string, block: BlockSchedule): BlockSchedule {
  const all = loadAll()
  const current = all[scenarioId] ?? { scenarioId, blocks: [] }
  const next = { ...block, updatedAt: new Date().toISOString() }
  const index = current.blocks.findIndex((item) => item.id === block.id)
  if (index >= 0) current.blocks[index] = next
  else current.blocks.push(next)
  all[scenarioId] = current
  saveAll(all)
  return next
}

export function deleteBlockSchedule(scenarioId: string, blockId: string): void {
  const all = loadAll()
  const current = all[scenarioId]
  if (!current) return
  current.blocks = current.blocks.filter((item) => item.id !== blockId)
  all[scenarioId] = current
  saveAll(all)
}

export function createBlockScheduleId(): string {
  return `block-${Date.now()}`
}
