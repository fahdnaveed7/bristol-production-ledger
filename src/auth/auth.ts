import { supabase } from '../lib/supabase'

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Hidden internal email so Supabase email/password auth can back a PIN-only UX.
export function emailFor(name: string): string {
  return `${slugify(name)}@bristol.local`
}

export async function listStaffNames(): Promise<string[]> {
  const { data, error } = await supabase.from('staff_directory').select('name')
  if (error) throw error
  return (data ?? []).map((r: { name: string }) => r.name)
}

export async function registerStaff(name: string, pin: string): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: emailFor(name),
    password: pin,
    options: { data: { name } },
  })
  if (error) throw error
}

export async function loginStaff(name: string, pin: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: emailFor(name),
    password: pin,
  })
  if (error) throw error
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut()
}
