import { test, expect, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'

const userId = '10000000-0000-4000-8000-000000000001'
const shiftId = '20000000-0000-4000-8000-000000000001'
const date = '2026-07-09'
async function fixture(page: Page, role = 'manager') {
  const tables: Record<string, any[]> = {
    profiles: [{ id: userId, name: role === 'qc' ? 'QAM Team' : 'Minhas', role }],
    shift: [{ id: shiftId, label: 'day', business_date: date, started_at: `${date}T08:00:00+05:30`, opening_balance_kg: 0, status: 'open' }],
    grn: [], batch: [], batch_output: [], shift_report: [], grn_pricing: [],
  }
  let closeFails = false
  const requests: { table: string; method: string; payload: any }[] = []
  await page.route('https://ledger-test.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url())
    const table = url.pathname.split('/').pop()!
    const method = req.method()
    const payload = req.postDataJSON()
    if (method === 'OPTIONS') return route.fulfill({ status: 200, body: '' })
    if (!url.pathname.includes('/rest/v1/')) return route.fulfill({ status: 200, json: {} })
    const matches = (row: any) => [...url.searchParams.entries()].every(([key, value]) => {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true
      const actual = key === 'shift.business_date' ? tables.shift.find((s) => s.id === row.shift_id)?.business_date : row[key]
      if (value.startsWith('eq.')) return String(actual) === value.slice(3)
      if (value.startsWith('gte.')) return actual >= value.slice(4)
      if (value.startsWith('lte.')) return actual <= value.slice(4)
      if (value.startsWith('in.')) return value.slice(4, -1).split(',').includes(actual)
      if (value === 'is.null') return actual == null
      return true
    })
    requests.push({ table, method, payload })
    if (method === 'PATCH' && table === 'shift' && closeFails) {
      closeFails = false
      return route.fulfill({ status: 503, json: { message: 'Connection interrupted' } })
    }
    let rows = table === 'staff_directory' ? tables.profiles.map((p) => ({ name: p.name })) : tables[table] ?? []
    if (method === 'POST') {
      const key = table === 'grn_pricing' ? 'grn_id' : 'id'
      const previous = rows.find((r) => r[key] === payload[key])
      if (table === 'shift_report' && rows.some((r) => r.shift_id === payload.shift_id)) return route.fulfill({ status: 409, json: { code: '23505', message: 'duplicate report' } })
      if (previous) Object.assign(previous, payload)
      else rows.push({ ...payload, created_at: new Date().toISOString(), generated_at: new Date().toISOString() })
      rows = rows.filter((r) => r[key] === payload[key])
    } else if (method === 'PATCH') {
      rows = rows.filter(matches)
      rows.forEach((r) => Object.assign(r, payload))
    } else rows = rows.filter(matches)
    if (table === 'grn') rows.forEach((g) => {
      g.net_kg = (g.gross_kg ?? 0) - (g.tare_kg ?? 0)
      g.sampled_estimate_kg = g.sample_boxes ? g.sample_weight_kg / g.sample_boxes * g.total_boxes : null
    })
    rows = rows.map((r) => {
      if (table === 'batch' && url.searchParams.get('select')?.includes('shift:')) return { ...r, shift: tables.shift.find((s) => s.id === r.shift_id) }
      if (table === 'batch_output' && url.searchParams.get('select')?.includes('batch:')) {
        const b = tables.batch.find((b) => b.id === r.batch_id)
        return { ...r, batch: { shift: tables.shift.find((s) => s.id === b?.shift_id) } }
      }
      return r
    })
    if (url.searchParams.get('order')?.includes('started_at.desc')) rows.reverse()
    const single = req.headers().accept?.includes('vnd.pgrst.object')
    return route.fulfill({ status: 200, json: single ? rows[0] ?? null : rows })
  })
  await page.addInitScript(({ userId }) => {
    localStorage.setItem('bristol-ledger-auth', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'fixture@bristol.local' } }))
  }, { userId })
  return { tables, requests, failCloseOnce: () => { closeFails = true } }
}
async function field(page: Page, label: string, value: string) {
  await page.locator('label').filter({ hasText: label }).first().locator('..').locator('input').fill(value)
}

test('four truck steps calculate scale, boxes, and receipt correctly', async ({ page }) => {
  const { tables, requests } = await fixture(page)
  await page.goto('/trucks')
  await page.getByRole('button', { name: '+ Truck arrived — weigh it in' }).click()
  await field(page, 'Vehicle no', 'TN-09-2231')
  await field(page, 'Weight on scale', '24860')
  await page.getByRole('button', { name: 'Save — send truck to unload' }).click()
  await field(page, 'Total boxes', '800')
  await field(page, 'Boxes weighed', '30')
  await field(page, 'Their weight', '600')
  await expect(page.getByText('Boxes say the truck holds')).toContainText('16,000')
  await page.getByRole('button', { name: 'Save box count' }).click()
  await field(page, 'Empty truck', '8940')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Scale and boxes agree')).toContainText('0.5%')
  await page.getByRole('button', { name: 'Confirm received — 15,920 kg' }).click()
  await expect(page.getByText('15,920 kg ✓')).toBeVisible()
  expect(tables.grn[0].status).toBe('received')
  expect(requests.every((r) => !r.payload || !('net_kg' in r.payload))).toBe(true)
})

test('feed and output flow to stock; failed close retries the same frozen report', async ({ page }) => {
  const fx = await fixture(page)
  fx.tables.grn.push({ id: 'received', shift_id: shiftId, status: 'received', gross_kg: 24860, tare_kg: 8940, net_kg: 15920 })
  await page.goto('/production')
  await field(page, 'Kg fed', '15000')
  await page.getByRole('button', { name: 'Record feed' }).click()
  await field(page, 'Bags', '60')
  await page.getByRole('button', { name: 'Record fishmeal', exact: true }).click()
  await field(page, 'Kg of oil', '750')
  await page.getByRole('button', { name: 'Record fish oil', exact: true }).click()
  await expect(page.getByText('20.0%')).toBeVisible()
  await expect(page.getByText('5.0%')).toBeVisible()
  await page.getByRole('link', { name: 'Stock', exact: false }).first().click()
  await expect(page.locator('tbody')).toContainText('3,000')
  await expect(page.locator('tbody')).toContainText('750')
  await page.goto('/production')
  fx.failCloseOnce()
  await page.getByRole('button', { name: 'End shift', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, end shift' }).click()
  await expect(page.getByText('Connection interrupted')).toBeVisible()
  expect(fx.tables.shift_report).toHaveLength(1)
  const frozen = { ...fx.tables.shift_report[0] }
  expect(frozen.verified_by).toBeNull()
  fx.tables.grn[0].gross_kg = 30000
  await page.getByRole('button', { name: 'Yes, end shift' }).click()
  await expect(page.getByText('No shift running')).toBeVisible()
  expect(fx.tables.shift_report).toEqual([frozen])
  expect(fx.tables.shift[0].closing_balance_kg).toBe(920)
  await page.goto('/reports')
  await page.getByRole('button', { name: /day shift/i }).click()
  await page.getByRole('button', { name: 'QC verify' }).click()
  await expect(page.getByText('Verified by Minhas')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('aside')).toBeHidden()
})

test('offline truck capture remains visible and syncs exactly once', async ({ page, context }) => {
  const fx = await fixture(page)
  await page.goto('/trucks')
  await page.getByRole('button', { name: '+ Truck arrived — weigh it in' }).click()
  await context.setOffline(true)
  await field(page, 'Vehicle no', 'OFFLINE-1')
  await field(page, 'Weight on scale', '24860')
  await page.getByRole('button', { name: 'Save — send truck to unload' }).click()
  await expect(page.getByText('Saved on this device — will send when internet is back')).toBeVisible()
  await expect(page.getByText('OFFLINE-1')).toBeVisible()
  await context.setOffline(false)
  await expect.poll(() => fx.tables.grn.length).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  expect(fx.requests.filter((r) => r.table === 'grn' && r.method === 'POST')).toHaveLength(1)
})

test('QC redirects from manager screens and never queries pricing', async ({ page }) => {
  const fx = await fixture(page, 'qc')
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('link', { name: /Dashboard/ })).toHaveCount(0)
  expect(fx.requests.filter((r) => r.table === 'grn_pricing')).toHaveLength(0)
})

test('date range applies to all five workbook sheets, including stock total and pricing', async ({ page }) => {
  const fx = await fixture(page)
  fx.tables.batch.push({ id: 'feed', batch_no: 'B-1', shift_id: shiftId, raw_fed_kg: 15000, operator_id: userId })
  fx.tables.batch_output.push({ id: 'meal', batch_id: 'feed', product: 'fishmeal', bags: 60, kg_per_bag: 50, total_kg: 3000 })
  fx.tables.grn.push({ id: 'truck', entry_date: date, vehicle_no: 'IN-RANGE', gross_kg: 24860, tare_kg: 8940, weighbridge_by: userId })
  fx.tables.grn.push({ id: 'old', entry_date: '2026-07-08', vehicle_no: 'OUT-OF-RANGE', gross_kg: 1000, tare_kg: 200 })
  fx.tables.grn_pricing.push({ grn_id: 'truck', rate_per_kg: 10, amount: 159200, entered_by: userId }, { grn_id: 'old', rate_per_kg: 10, amount: 8000 })
  fx.tables.shift.push({ id: 'previous-shift', label: 'night', business_date: '2026-07-08', status: 'closed' })
  fx.tables.batch.push({ id: 'previous-feed', shift_id: 'previous-shift', raw_fed_kg: 10000 })
  fx.tables.batch_output.push({ id: 'previous-meal', batch_id: 'previous-feed', product: 'fishmeal', bags: 20, kg_per_bag: 50, total_kg: 1000 })
  await page.goto('/dashboard')
  await field(page, 'From', date); await field(page, 'To', date)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Full Excel workbook/ }).click()
  const file = await download
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile((await file.path())!)
  expect(wb.worksheets.map((s) => s.name)).toEqual(['Shift Reports', 'Trucks', 'Production', 'Stock Register', 'Pricing'])
  expect(wb.getWorksheet('Stock Register')!.getCell('D6').value).toBe(3000)
  expect(wb.getWorksheet('Pricing')!.getCell('B5').value).toBe('IN-RANGE')
  expect(wb.getWorksheet('Pricing')!.rowCount).toBe(5)
  expect(wb.getWorksheet('Trucks')!.getCell('M5').value).toBe('Minhas')
  expect(wb.getWorksheet('Production')!.getCell('C5').value).toBe('Minhas')
  expect(wb.getWorksheet('Trucks')!.getCell('A4').fill).toMatchObject({ fgColor: { argb: 'FF1A293C' } })
})

test('phone layout has no overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.goto('/production')
  await expect(page.getByRole('button', { name: 'Record feed' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/production-mobile.png', fullPage: true })
})


test('unreachable staff directory shows a connection error, not an empty directory', async ({ page }) => {
  await page.route('https://ledger-test.supabase.co/**', (route) => route.abort('namenotresolved'))
  await page.goto('/login')
  await expect(page.getByText('Could not connect to the staff directory.')).toBeVisible()
  await expect(page.getByText('No staff yet — use Register.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Enter', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
})
