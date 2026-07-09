import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { landingPath } from './components/nav'
import { Login } from './screens/Login'
import { Trucks } from './screens/Trucks'
import { Production } from './screens/Production'
import { Reports } from './screens/Reports'
import { Dashboard } from './screens/Dashboard'
import { Team } from './screens/Team'
import type { Role } from './lib/types'

function Splash() {
  return <div className="min-h-full grid place-items-center text-gray-400">Loading…</div>
}

// Gate a screen behind auth + role. Redirects unknown roles to their landing screen.
function Protected({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { session, role, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />
  if (role && !allow.includes(role)) return <Navigate to={landingPath(role)} replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const { session, role, loading } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <Splash /> : session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route path="/" element={loading ? <Splash /> : <Navigate to={session ? landingPath(role) : '/login'} replace />} />

      <Route path="/trucks" element={<Protected allow={['weighbridge', 'receiving', 'manager']}><Trucks /></Protected>} />
      <Route path="/production" element={<Protected allow={['production', 'manager']}><Production /></Protected>} />
      <Route path="/reports" element={<Protected allow={['qc', 'manager']}><Reports /></Protected>} />
      <Route path="/dashboard" element={<Protected allow={['manager']}><Dashboard /></Protected>} />
      <Route path="/team" element={<Protected allow={['manager']}><Team /></Protected>} />

      {/* old paths from the previous layout */}
      <Route path="/weighbridge" element={<Navigate to="/trucks" replace />} />
      <Route path="/receiving" element={<Navigate to="/trucks" replace />} />
      <Route path="/shift" element={<Navigate to="/production" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
