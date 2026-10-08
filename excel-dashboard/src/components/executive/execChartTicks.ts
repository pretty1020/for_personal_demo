/** Evenly spaced category indices for readable x-axis labels. */
export function pickCategoryTickIndices(length: number, maxTicks: number): number[] {
  if (length <= 0) return []
  if (length <= maxTicks) return Array.from({ length }, (_, i) => i)
  const out: number[] = [0]
  const step = (length - 1) / (maxTicks - 1)
  for (let i = 1; i < maxTicks - 1; i++) {
    out.push(Math.round(i * step))
  }
  out.push(length - 1)
  return [...new Set(out)].sort((a, b) => a - b)
}
