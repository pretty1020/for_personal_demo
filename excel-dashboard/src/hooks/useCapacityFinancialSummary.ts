import { useIdealFinancial } from '../context/IdealFinancialContext'

export function useCapacityFinancialWeekRange() {
  const { dateRangeActive, weekStart, weekEnd } = useIdealFinancial()
  return dateRangeActive ? { weekStart, weekEnd } : { weekStart: '', weekEnd: '' }
}
