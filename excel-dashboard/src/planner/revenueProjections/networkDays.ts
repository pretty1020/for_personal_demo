/** Network (working) days = Mon–Fri calendar days in a month (YYYY-MM). */

export function networkDaysInMonth(monthKey: string): number {
  const prefix = monthKey.length >= 7 ? monthKey.slice(0, 7) : monthKey
  const year = Number.parseInt(prefix.slice(0, 4), 10)
  const month = Number.parseInt(prefix.slice(5, 7), 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 0

  const daysInMonth = new Date(year, month, 0).getDate()
  let count = 0
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = new Date(year, month - 1, day).getDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

export function listMonthKeys(year: number, count = 12): string[] {
  return Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, '0')
    return `${year}-${month}`
  })
}

export function formatMonthShort(monthKey: string): string {
  const date = new Date(`${monthKey.slice(0, 7)}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}
