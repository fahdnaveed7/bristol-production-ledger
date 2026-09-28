import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { cachedRows } from '../offline/cache'
import type { Profile, Role } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  refreshProfile: () => Promise<void>
}
const Ctx = createContext<AuthState | undefined>(undefined)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId: string) {
    const rows = await cachedRows<Profile>('profile', supabase.from('profiles').select('*').eq('id', userId))
    return rows.find((p) => p.id === userId) ?? null
  }
  useEffect(() => {
    let active = true
    let generation = 0
    const receive = async (s: Session | null) => {
      const current = ++generation
      setLoading(true)
      setSession(s)
      setProfile(null)
      try {
        const p = s ? await fetchProfile(s.user.id) : null
        if (active && current === generation) setProfile(p)
      } finally {
        if (active && current === generation) setLoading(false)
      }
    }
    // Defer queries until the auth callback releases its session lock.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      window.setTimeout(() => { if (active) void receive(s).catch(() => {}) }, 0)
    })
    void supabase.auth.getSession().then(({ data }) => { if (active) return receive(data.session) }).catch(() => setLoading(false))
    const refresh = () => { void supabase.auth.getSession().then(({ data }) => data.session && fetchProfile(data.session.user.id).then((p) => { if (active) setProfile(p) })).catch(() => {}) }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { active = false; sub.subscription.unsubscribe(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [])
  return <Ctx.Provider value={{ session, profile, role: profile?.role ?? null, loading,
    refreshProfile: async () => { if (session) setProfile(await fetchProfile(session.user.id)) },
  }}>{children}</Ctx.Provider>
}
export function useAuth(): AuthState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
