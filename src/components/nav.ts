import type { Role } from '../lib/types'

export interface NavItem {
  path: string
  label: string
  icon: string // emoji keeps the bundle asset-free and factory-legible
  roles: Role[] // which roles see this screen
}

// Screen order mirrors the material's journey through the plant.
export const NAV: NavItem[] = [
  { path: '/weighbridge', label: 'Weighbridge', icon: '⚖️', roles: ['weighbridge', 'manager'] },
  { path: '/receiving', label: 'Receiving', icon: '📦', roles: ['receiving', 'manager'] },
  { path: '/production', label: 'Production', icon: '🏭', roles: ['production', 'manager'] },
  { path: '/shift', label: 'Shift', icon: '🕗', roles: ['production', 'manager'] },
  { path: '/reports', label: 'Reports', icon: '📄', roles: ['qc', 'manager'] },
  { path: '/dashboard', label: 'Dashboard', icon: '📊', roles: ['manager'] },
  { path: '/team', label: 'Team', icon: '👥', roles: ['manager'] },
]

export function navForRole(role: Role | null): NavItem[] {
  if (!role) return []
  return NAV.filter((n) => n.roles.includes(role))
}

export function landingPath(role: Role | null): string {
  const items = navForRole(role)
  return items[0]?.path ?? '/weighbridge'
}
