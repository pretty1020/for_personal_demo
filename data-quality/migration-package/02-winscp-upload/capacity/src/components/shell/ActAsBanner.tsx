import { useEffect, useState } from 'react'
import { subscribeActAs, type ActAsTarget } from '../../data/capacityActAs'
import { exitActAsPlanner } from '../../data/capacityDocuments'

/**
 * Says whose plans are on screen while a manager is editing for someone else.
 *
 * Deliberately loud and always mounted. Every page in the app looks identical in this
 * mode, so without a standing reminder it is genuinely easy to spend a while editing
 * a colleague's numbers believing they are your own.
 */
export function ActAsBanner() {
  const [target, setTarget] = useState<ActAsTarget | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => subscribeActAs(setTarget), [])

  if (!target) return null

  const leave = async () => {
    setLeaving(true)
    try {
      await exitActAsPlanner()
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div className="cap-act-as" role="status">
      <span className="cap-act-as__dot" aria-hidden />
      <span className="cap-act-as__text">
        You are editing <strong>{target.name}</strong>&rsquo;s plans. Changes save to their
        account and are recorded against your name.
      </span>
      <button type="button" className="cap-act-as__exit" onClick={leave} disabled={leaving}>
        {leaving ? 'Returning…' : 'Back to my plans'}
      </button>
    </div>
  )
}
