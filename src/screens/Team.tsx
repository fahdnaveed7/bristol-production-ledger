import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import type { Profile, Role } from '../lib/types'
import { ROLE_LABEL } from '../lib/types'
import { EmptyState, Notice, PageHeader } from '../components/ui'

const ROLES: Role[] = ['weighbridge', 'receiving', 'production', 'qc', 'manager']

export function Team() {
  const { profile, refreshProfile } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('name')
    setPeople((data as Profile[]) ?? [])
  }
  useEffect(() => {
    void load()
  }, [])

  async function setRole(id: string, role: Role) {
    setMsg(null)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) setMsg(error.message)
    else {
      setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, role } : p)))
      setMsg('Role updated')
      if (id === profile?.id) await refreshProfile()
    }
  }

  return (
    <>
      <PageHeader title="Team" subtitle="Assign roles. Nav adapts to each person's role." />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg === 'Role updated' ? 'success' : 'error'}>{msg}</Notice>
        </div>
      )}
      {people.length === 0 ? (
        <EmptyState>No staff registered yet.</EmptyState>
      ) : (
        <div className="space-y-2">
          {people.map((p) => (
            <div key={p.id} className="card p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{p.name}</div>
                <div className="text-xs text-gray-400">{ROLE_LABEL[p.role]}</div>
              </div>
              <select aria-label={`Role for ${p.name}`} className="field w-40 py-2" value={p.role} onChange={(e) => setRole(p.id, e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
