import type { Role } from '../lib/types'

export interface NavItem {
  path: string
  label: string
  icon: string
  roles: Role[]
}

// 5 screens. Floor roles see 1; production sees 1; manager sees all.
export const NAV: NavItem[] = [
  { path: '/trucks', label: 'Trucks', icon: '🚚', roles: ['weighbridge', 'receiving', 'manager'] },
  { path: '/production', label: 'Production', icon: '🏭', roles: ['production', 'manager'] },
  { path: '/reports', label: 'Reports', icon: '📄', roles: ['qc', 'manager'] },
  { path: '/dashboard', label: 'Dashboard', icon: '📊', roles: ['manager'] },
  { path: '/team', label: 'Team', icon: '👥', roles: ['manager'] },
]

export function navForRole(role: Role | null): NavItem[] {
  if (!role) return []
  return NAV.filter((n) => n.roles.includes(role))
}

export function landingPath(role: Role | null): string {
  switch (role) {
    case 'manager': return '/dashboard'
    case 'qc': return '/reports'
    case 'production': return '/production'
    default: return '/trucks'
  }
}
