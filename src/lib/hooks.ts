import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import { getOpenShift } from './shift'
import type { Shift, Profile } from './types'

export function useOpenShift() {
  const [shift, setShift] = useState<Shift | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setShift(await getOpenShift())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const ch = supabase
      .channel('open-shift')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift' }, () => void reload())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [reload])

  return { shift, loading, reload }
}

export function useProfiles(): Record<string, Profile> {
  const [map, setMap] = useState<Record<string, Profile>>({})
  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => {
        const m: Record<string, Profile> = {}
        ;(data as Profile[] | null ?? []).forEach((p) => (m[p.id] = p))
        setMap(m)
      })
  }, [])
  return map
}

// Re-run `onChange` whenever any of the given tables change (Realtime).
export function useRealtime(tables: string[], onChange: () => void) {
  useEffect(() => {
    const ch = supabase.channel(`rt-${tables.join('-')}`)
    tables.forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange))
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(','), onChange])
}
