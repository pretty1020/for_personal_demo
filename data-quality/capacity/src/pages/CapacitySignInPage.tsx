import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CapacitySignInForm } from '../components/auth/CapacitySignInForm'
import { useDemoSession } from '../context/DemoSessionContext'

export function CapacitySignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authenticated } = useDemoSession()

  if (authenticated) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/summary'} replace />
  }

  return (
    <CapacitySignInForm
      embedded
      onSuccess={() => {
        const from = (location.state as { from?: string } | null)?.from
        navigate(from ?? '/summary', { replace: true })
      }}
    />
  )
}
