import { describe, expect, it, vi, beforeEach } from 'vitest'
import { yieldPct, divergenceFraction, isDivergent } from '../src/lib/yield'
import { localDate, dateStr } from '../src/lib/format'
import { readAll } from '../src/lib/read'
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
import { suggestShift } from '../src/lib/shift'
import { toCsv } from '../src/lib/export'

describe('brief acceptance arithmetic', () => {
  it('agrees within 0.5% for the example truck, flags +25%', () => {
    const net = 24860 - 8940
    const estimate = (600 / 30) * 800
    expect(net).toBe(15920)
    expect(estimate).toBe(16000)
    expect((divergenceFraction(net, estimate)! * 100).toFixed(1)).toBe('0.5')
    expect(isDivergent(net, estimate)).toBe(false)
    expect(divergenceFraction(8000, 10000)).toBe(.25)
    expect(isDivergent(8000, 10000)).toBe(true)
  })
  it('computes shift output yields and handles no feed', () => {
    expect(yieldPct(60 * 50, 15000)).toBe(20)
    expect(yieldPct(750, 15000)).toBe(5)
    expect(yieldPct(0, 0)).toBeNull()
  })
})
describe('local shift dates', () => {
  beforeEach(() => { process.env.TZ = 'America/Chicago' })
  it('keeps a late local night on its start date', () => {
    expect(suggestShift(new Date('2026-07-09T23:30:00-05:00'))).toEqual({ label: 'night', business_date: '2026-07-09' })
    expect(suggestShift(new Date('2026-07-10T02:30:00-05:00'))).toEqual({ label: 'night', business_date: '2026-07-09' })
    expect(suggestShift(new Date('2026-07-10T08:00:00-05:00'))).toEqual({ label: 'day', business_date: '2026-07-10' })
    expect(localDate(new Date('2026-07-09T23:30:00-05:00'))).toBe('2026-07-09')
    expect(dateStr('2026-07-09')).toContain('09')
  })
})
describe('export integrity', () => {
  it('reads beyond the server page limit and does not swallow failures', async () => {
    const records = Array.from({ length: 1205 }, (_, id) => ({ id }))
    const range = vi.fn(async (start: number, end: number) => ({ data: records.slice(start, end + 1), error: null }))
    expect((await readAll({ range })).data).toHaveLength(1205)
    expect(range).toHaveBeenCalledTimes(3)
    await expect(readAll({ range: async () => ({ data: null, error: { message: 'connection failed' } }) })).rejects.toEqual({ message: 'connection failed' })
  })
  it('escapes commas and formula-like staff text without changing numeric amounts', () => {
    expect(toCsv(['name', 'amount'], [['=1+1', -20], ['A, B', 30]])).toBe("name,amount\n'=1+1,-20\n\"A, B\",30")
  })
})
