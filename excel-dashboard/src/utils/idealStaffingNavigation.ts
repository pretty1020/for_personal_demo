/** Query + session flag so Capacity Plan loads the Ideal Financial staffing sample. */
export const IDEAL_STAFFING_SAMPLE_QUERY = 'ideal-financial'
export const IDEAL_STAFFING_SAMPLE_STORAGE_KEY = 'ideal-financial-staffing-sample'

export function markIdealStaffingSampleForLoad(): void {
  try {
    sessionStorage.setItem(IDEAL_STAFFING_SAMPLE_STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function shouldLoadIdealStaffingSample(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('sample') === IDEAL_STAFFING_SAMPLE_QUERY) return true
    return sessionStorage.getItem(IDEAL_STAFFING_SAMPLE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function clearIdealStaffingSampleFlag(): void {
  try {
    sessionStorage.removeItem(IDEAL_STAFFING_SAMPLE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export const IDEAL_STAFFING_PLAN_PATH = '/capacity-plan'
