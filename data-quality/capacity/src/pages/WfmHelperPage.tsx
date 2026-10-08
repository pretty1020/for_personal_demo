import { useNavigate } from 'react-router-dom'
import { WfmHelperPanel } from '../components/planner/WfmHelperPanel'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'

export function WfmHelperPage() {
  const navigate = useNavigate()

  return (
    <div className="cap-wfm-helper-page">
      <ModulePageHeader
        title="WFM Helper"
        description="Glossary, Erlang sense-check, and quick reference for Staffing Plan workflows."
        actions={
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            onClick={() => navigate('/capacity-plan')}
          >
            Back to Staffing Plan
          </button>
        }
      />
      <WfmHelperPanel onClose={() => navigate('/capacity-plan')} />
    </div>
  )
}
