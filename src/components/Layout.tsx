import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { logout } from '../auth/auth'
import { navForRole } from './nav'
import { ROLE_LABEL } from '../lib/types'
import { onQueueChange } from '../offline/queue'

function OfflineChip() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const unsub = onQueueChange(setPending)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      unsub()
    }
  }, [])
  if (online && pending === 0) return null
  return (
    <span className={`badge ${online ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-700'}`}>
      {online ? `↑ syncing ${pending}` : `● offline${pending ? ` · ${pending} queued` : ''}`}
    </span>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { profile, role } = useAuth()
  const nav = useNavigate()
  const items = navForRole(role)

  async function onLogout() {
    await logout()
    nav('/login')
  }

  return (
    <div className="min-h-full md:flex">
      {/* Desktop left rail */}
      <aside className="hidden md:flex md:flex-col md:w-56 md:shrink-0 border-r border-gray-200 bg-white">
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="font-bold text-teal leading-tight">Bristol Proteins &amp; Oils</div>
          <div className="text-xs text-gray-400">Production Ledger</div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {items.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-teal-light text-teal-dark' : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              <span className="text-lg">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-200">
          <div className="text-sm font-medium text-gray-900">{profile?.name}</div>
          <div className="text-xs text-gray-400 mb-2">{role ? ROLE_LABEL[role] : ''}</div>
          <button className="btn-ghost w-full py-2 text-sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="font-bold text-teal text-sm">Bristol Ledger</div>
          <div className="flex items-center gap-2">
            <OfflineChip />
            <button className="text-xs text-gray-500 underline" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </header>

        <div className="hidden md:flex items-center justify-end px-6 py-2 gap-2">
          <OfflineChip />
        </div>

        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6 max-w-3xl w-full mx-auto">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 grid grid-flow-col auto-cols-fr z-10">
          {items.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${
                  isActive ? 'text-teal font-semibold' : 'text-gray-500'
                }`
              }
            >
              <span className="text-xl leading-none">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
