// Phase 8: facade guard - timeout mechanism at the exact 5 s boundary (fake timers, no real
// waiting), timer cleanup, error sanitizing, and that MOCK failure modes live only in the mock.
const fs = require('fs')
const path = require('path')
const { withTimeout, sanitize, FacadeTimeout, DEFAULT_TIMEOUT_MS } = require('../../srv/external/facade-guard')

const SRV = path.join(__dirname, '../../srv')
const never = () => new Promise(() => {})

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('the default limit is 5000 ms', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5000)
  })

  test('still waiting at 4999 ms, rejects with FacadeTimeout at 5000 ms and aborts the signal', async () => {
    let signal
    let outcome = 'pending'
    const call = withTimeout(s => { signal = s; return never() }, DEFAULT_TIMEOUT_MS)
      .then(() => { outcome = 'resolved' }, error => { outcome = error })

    await jest.advanceTimersByTimeAsync(4999)
    expect(outcome).toBe('pending')
    expect(signal.aborted).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    await call
    expect(outcome).toBeInstanceOf(FacadeTimeout)
    expect(outcome).toMatchObject({ code: 'FACADE_TIMEOUT', message: 'Timeout after 5000 ms' })
    expect(signal.aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  test('a fast answer is returned and leaves no timer behind', async () => {
    await expect(withTimeout(async () => 'answer', 5000)).resolves.toBe('answer')
    expect(jest.getTimerCount()).toBe(0)
  })

  test('a failing call keeps its own error and leaves no timer behind', async () => {
    await expect(withTimeout(async () => { throw new Error('boom') }, 5000)).rejects.toThrow('boom')
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('sanitize', () => {
  test('removes URLs, tokens and credentials and keeps the error code', () => {
    const error = Object.assign(new Error(
      'GET https://s4.example.com/sap/opu/odata/API_PO?sap-client=100 failed: Authorization: Bearer eyJhbGciOi.abc.def password=Secret123 apikey: k-42'), { code: 'ECONNRESET' })
    const text = sanitize(error)
    expect(text).toMatch(/^ECONNRESET: GET <url> failed/)
    for (const leaked of ['s4.example.com', 'sap-client', 'eyJhbGciOi', 'Secret123', 'k-42']) expect(text).not.toContain(leaked)
  })

  test('keeps only the first line (no stack trace) and at most 300 characters', () => {
    const error = new Error(`${'x'.repeat(400)}\n    at secret (file.js:1:1)`)
    expect(sanitize(error)).toHaveLength(300)
    expect(sanitize(new Error('first\nsecond'))).toBe('first')
  })
})

describe('MOCK failure modes cannot reach production code', () => {
  test('only the mock implementation reads mock.failureMode', () => {
    const readers = []
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(file)
      if (/\.(js|cds)$/.test(entry.name) && fs.readFileSync(file, 'utf8').includes('failureMode')) readers.push(path.relative(SRV, file))
    })
    walk(SRV)
    expect(readers).toEqual([path.join('external', 'mock-po-service.js')])
  })

  test('production configuration has no mock implementation and no failure mode', () => {
    const { cds } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'))
    const production = cds.requires.ExternalPurchaseOrderService
    expect(production).toEqual({ model: 'srv/external/purchase-order-facade', timeout: 5000 })
    expect(cds.requires['[production]']?.ExternalPurchaseOrderService?.mock).toBeUndefined()
  })
})
