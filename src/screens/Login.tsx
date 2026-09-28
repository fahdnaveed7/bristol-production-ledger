import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listStaffNames, loginStaff, registerStaff } from '../auth/auth'
import { Notice } from '../components/ui'

const PIN_LEN = 6

export function Login() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [names, setNames] = useState<string[]>([])
  const [name, setName] = useState('')
  const [newName, setNewName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listStaffNames()
      .then((n) => {
        setNames(n)
        if (n[0]) setName(n[0])
      })
      .catch(() => setError('Could not load the staff list. Can you check the internet and try again?'))
  }, [])

  function press(d: string) {
    setError(null)
    setPin((p) => (p.length >= PIN_LEN ? p : p + d))
  }
  function backspace() {
    setPin((p) => p.slice(0, -1))
  }

  async function submit() {
    setError(null)
    if (pin.length !== PIN_LEN) {
      setError('Enter your 6-digit PIN')
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        if (!name) throw new Error('Pick your name')
        await loginStaff(name, pin)
      } else {
        if (!newName.trim()) throw new Error('Enter your name')
        await registerStaff(newName.trim(), pin)
        await loginStaff(newName.trim(), pin)
      }
      nav('/')
    } catch (e) {
      setError((e as Error).message ?? 'Sign-in failed')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-xl bg-gold text-white grid place-items-center text-2xl font-bold mb-3">
            B
          </div>
          <h1 className="text-lg font-bold text-navy">Bristol Proteins &amp; Oils</h1>
          <p className="text-sm text-gray-500">Production Ledger</p>
        </div>

        <div className="card p-5">
          <div className="flex rounded-md bg-gray-100 p-1 mb-4 text-sm font-semibold">
            <button
              className={`flex-1 rounded py-2 ${mode === 'login' ? 'bg-white shadow-sm text-navy' : 'text-gray-500'}`}
              onClick={() => { setMode('login'); setError(null); setPin('') }}
            >
              Sign in
            </button>
            <button
              className={`flex-1 rounded py-2 ${mode === 'register' ? 'bg-white shadow-sm text-navy' : 'text-gray-500'}`}
              onClick={() => { setMode('register'); setError(null); setPin('') }}
            >
              Register
            </button>
          </div>

          {mode === 'login' ? (
            <div className="mb-4">
              <label className="label">Your name</label>
              {names.length ? (
                <select aria-label="Your name" className="field" value={name} onChange={(e) => setName(e.target.value)}>
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-400">No staff yet — use Register.</p>
              )}
            </div>
          ) : (
            <div className="mb-4">
              <label className="label">Your name</label>
              <input
                aria-label="Your name"
                className="field"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Imran Khan"
                autoCapitalize="words"
              />
              <p className="text-xs text-gray-400 mt-1">New accounts start as Weighbridge until a manager sets your role.</p>
            </div>
          )}

          <label className="label" htmlFor="staff-pin">6-digit PIN</label>
          <input id="staff-pin" className="sr-only" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          <div className="flex justify-center gap-2 mb-4">
            {Array.from({ length: PIN_LEN }).map((_, i) => (
              <div
                key={i}
                className={`w-8 h-10 rounded-md border grid place-items-center text-xl ${
                  pin.length > i ? 'border-navy bg-navy-light' : 'border-gray-300'
                }`}
              >
                {pin.length > i ? '•' : ''}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} className="btn-ghost text-xl py-4" onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button aria-label="Backspace" className="btn-ghost text-sm py-4" onClick={backspace}>
              ⌫
            </button>
            <button className="btn-ghost text-xl py-4" onClick={() => press('0')}>
              0
            </button>
            <button className="btn-primary py-4" onClick={submit} disabled={busy}>
              {busy ? '…' : mode === 'login' ? 'Enter' : 'Create'}
            </button>
          </div>

          {error && (
            <div className="mt-4">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
