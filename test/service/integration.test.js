// Phase 8: integration hardening of the S/4 facade - MessageLog (one row per call, independent
// of the business transaction), correlation IDs, timeout, S4_UNAVAILABLE, MOCK failure modes,
// and R2 (parallel Match requests on one invoice).
//
// Test fixture PO 4500000901 (test/data): supplier 1000020, company code 1010, group 001.
// Failure modes and the timeout are switched through cds.env, exactly like a developer would
// in package.json; afterEach restores the defaults ('none', 5000 ms).
const cds = require('@sap/cds')
const path = require('path')
const { Ratio } = require('../../srv/lib/decimal')

const { GET, POST, PATCH, DELETE, data, axios } = cds.test(path.join(__dirname, '../..'))
axios.defaults.headers['If-Match'] = '*' // Fiori sends the current ETag on every write

const INV = '/odata/v4/invoice', EXC = '/odata/v4/exception', ADM = '/odata/v4/admin'
const as = user => ({ auth: { username: user, password: '' } })
const CLERK = as('clerk1'), BUYER1 = as('buyer1'), MANAGER = as('manager1'), NOBODY = as('nobody')
const statusOf = promise => promise.then(r => r.status, e => e.response?.status)
const failure = promise => promise.then(() => { throw new Error('expected the request to fail') }, e => e.response)

const facadeConfig = () => cds.env.requires.ExternalPurchaseOrderService
const DEFAULTS = { timeout: facadeConfig().timeout, failureMode: facadeConfig().mock.failureMode }
const simulate = failureMode => { facadeConfig().mock.failureMode = failureMode }
const SHORT_TIMEOUT = 200 // ms - keeps the timeout tests fast; the 5 s value itself is tested below
const useTimeout = ms => { facadeConfig().timeout = ms }

const activeUrl = id => `${INV}/Invoices(ID=${id},IsActiveEntity=true)`
const draftUrl = id => `${INV}/Invoices(ID=${id},IsActiveEntity=false)`
const match = (id, user = CLERK, headers = {}) =>
  POST(`${activeUrl(id)}/InvoiceService.match`, {}, { ...user, headers })

let referenceCounter = 0
/** Creates a draft for PO 4500000901 item 00010 (price 1000, received 50). */
async function draft(quantity = 1, price = 1000) {
  const net = Ratio.of(quantity).times(price).toFixed(2)
  const { data: { ID } } = await POST(`${INV}/Invoices`, {}, CLERK)
  await PATCH(draftUrl(ID), {
    supplierID: '1000020', purchaseOrder: '4500000901', companyCode: '1010', currency_code: 'INR',
    supplierReference: `INT-${++referenceCounter}`, invoiceDate: '2026-10-15',
    netAmount: net, taxAmount: 0, grossAmount: net
  }, CLERK)
  await POST(`${draftUrl(ID)}/items`, { purchaseOrderItem: '00010', quantity, unit: 'EA', unitPrice: price, netAmount: net }, CLERK)
  return ID
}
const submit = id => POST(`${draftUrl(id)}/InvoiceService.draftActivate`, {}, CLERK)
async function validatedInvoice(quantity, price) {
  const id = await draft(quantity, price)
  await submit(id)
  return id
}

/** MessageLog rows, oldest first, optionally only those created after `since` rows. */
const logRows = () => SELECT.from('ap.MessageLog').orderBy('createdAt', 'ID')
const logRowsFor = async invoiceID => (await logRows()).filter(r => r.invoice_ID === invoiceID)

/** Everything a match run writes - must be untouched after a failed match. */
async function matchFootprint(id) {
  const [invoice, results, exceptions, items, history] = await Promise.all([
    SELECT.one.from('ap.Invoices').columns('status', 'approvalReason', 'lastMatchRunID', 'lastMatchAt', 'modifiedAt').where({ ID: id }),
    SELECT.from('ap.MatchResults').where({ invoice_ID: id }),
    SELECT.from('ap.Exceptions').where({ invoice_ID: id }),
    SELECT.from('ap.InvoiceItems').columns('matchStatus').where({ up__ID: id }),
    SELECT.from('ap.ApprovalHistory').columns('action').where({ invoice_ID: id })
  ])
  return { invoice, results, exceptions, items, history }
}

beforeEach(data.reset)
afterEach(() => { simulate(DEFAULTS.failureMode); useTimeout(DEFAULTS.timeout) })

describe('configuration', () => {
  test('defaults: 5000 ms timeout and no simulated failure', () => {
    expect(DEFAULTS).toEqual({ timeout: 5000, failureMode: 'none' })
  })
})

describe('I3 - successful match is logged', () => {
  test('one SUCCESS row per facade call, one correlation ID per request, S4_MOCK, durations', async () => {
    const id = await validatedInvoice()
    const submitRows = await logRowsFor(id)
    expect(submitRows.map(r => r.operation).sort()).toEqual(['getPurchaseOrder', 'getSupplier'])

    expect((await match(id)).data.status).toBe('MATCHED')
    const matchRows = (await logRowsFor(id)).slice(submitRows.length)
    expect(matchRows.map(r => r.operation).sort()).toEqual(['getPurchaseOrder', 'getReceivedQuantities', 'getSupplier'])
    for (const row of [...submitRows, ...matchRows]) {
      expect(row).toMatchObject({ direction: 'OUT', targetSystem: 'S4_MOCK', status: 'SUCCESS', errorMessage: null, invoice_ID: id })
      expect(Number.isInteger(row.durationMs)).toBe(true)
      expect(row.durationMs).toBeGreaterThanOrEqual(0)
      expect(row.durationMs).toBeLessThan(5000)
      expect(row.createdAt).toBeTruthy()
    }
    // all calls of one request share its correlation ID; the two requests have different ones
    expect(new Set(submitRows.map(r => r.correlationID)).size).toBe(1)
    expect(new Set(matchRows.map(r => r.correlationID)).size).toBe(1)
    expect(matchRows[0].correlationID).not.toBe(submitRows[0].correlationID)
  })

  test('a correlation ID sent by the caller (x-correlation-id) is used for all calls of the request', async () => {
    const id = await validatedInvoice()
    const correlationID = cds.utils.uuid()
    await match(id, CLERK, { 'x-correlation-id': correlationID })
    const rows = (await logRowsFor(id)).slice(2) // after the two submit calls
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.correlationID).toBe(correlationID)
  })

  test('value helps are logged too (every facade operation), without an invoice', async () => {
    await GET(`${INV}/Suppliers?$search=1000`, CLERK)
    await GET(`${INV}/Suppliers('1000020')`, CLERK)
    await GET(`${INV}/PurchaseOrders?$filter=supplierID eq '1000020'`, CLERK)
    await GET(`${INV}/PurchaseOrderItems?$filter=purchaseOrder eq '4500000901'`, CLERK)
    const rows = await logRows()
    expect(rows.map(r => r.operation)).toEqual(['searchSuppliers', 'getSupplier', 'searchPurchaseOrders', 'listPurchaseOrderItems'])
    for (const row of rows) expect(row).toMatchObject({ status: 'SUCCESS', invoice_ID: null, targetSystem: 'S4_MOCK' })
    expect(new Set(rows.map(r => r.correlationID)).size).toBe(4) // four requests, four IDs
  })

  test('a business "not found" (404) is an answer, not a failure: logged SUCCESS', async () => {
    const { data: { value } } = await GET(`${INV}/Suppliers?$filter=supplierID eq '9999999'`, CLERK)
    expect(value).toEqual([])
    expect(await logRows()).toMatchObject([{ operation: 'getSupplier', status: 'SUCCESS', errorMessage: null }])
  })
})

describe('I1 - S/4 timeout during match', () => {
  test('503 S4_UNAVAILABLE, invoice stays VALIDATED, nothing partial written, FAILED rows survive the rollback', async () => {
    const id = await validatedInvoice()
    const before = await matchFootprint(id)
    const logBefore = (await logRows()).length
    useTimeout(SHORT_TIMEOUT); simulate('timeout')

    const started = Date.now()
    const response = await failure(match(id))
    expect(Date.now() - started).toBeGreaterThanOrEqual(SHORT_TIMEOUT - 5)
    expect(Date.now() - started).toBeLessThan(5000) // the configured limit, not the 5 s default
    expect(response.status).toBe(503)
    expect(response.data.error.code).toBe('S4_UNAVAILABLE')
    expect(response.data.error.message).toBe('The S/4HANA system is not available right now. Nothing was changed; please try again later.')
    expect(JSON.stringify(response.data)).not.toMatch(/timeout|MOCK|abort|stack/i)

    expect(await matchFootprint(id)).toEqual(before)
    expect(before.invoice).toMatchObject({ status: 'VALIDATED', lastMatchRunID: null })
    expect(before.results).toEqual([])
    expect(before.items).toEqual([{ matchStatus: 'NOT_MATCHED' }])
    expect(before.history.map(h => h.action)).toEqual(['SUBMIT'])

    // written in their own transaction although the request's transaction was rolled back
    const failed = (await logRows()).slice(logBefore)
    expect(failed.map(r => r.operation).sort()).toEqual(['getPurchaseOrder', 'getReceivedQuantities', 'getSupplier'])
    for (const row of failed) {
      expect(row).toMatchObject({ status: 'FAILED', invoice_ID: id, errorMessage: `FACADE_TIMEOUT: Timeout after ${SHORT_TIMEOUT} ms` })
      expect(row.durationMs).toBeGreaterThanOrEqual(SHORT_TIMEOUT - 5)
    }
    expect(new Set(failed.map(r => r.correlationID)).size).toBe(1)
  })

  test('retry after the failure succeeds and writes exactly one run', async () => {
    const id = await validatedInvoice()
    useTimeout(SHORT_TIMEOUT); simulate('timeout')
    expect((await failure(match(id))).status).toBe(503)
    simulate('none')
    expect((await match(id)).data.status).toBe('MATCHED')
    const { invoice, results, history } = await matchFootprint(id)
    expect(new Set(results.map(r => r.runID))).toEqual(new Set([invoice.lastMatchRunID]))
    expect(history.map(h => h.action)).toEqual(['SUBMIT', 'MATCH'])
    const statuses = (await logRowsFor(id)).map(r => r.status)
    expect(statuses.filter(s => s === 'FAILED')).toHaveLength(3)
    expect(statuses.filter(s => s === 'SUCCESS')).toHaveLength(2 + 3) // submit + successful match
  })
})

describe('S/4 error during match', () => {
  test('503, nothing partial written, the cause is logged but never shown to the user', async () => {
    const id = await validatedInvoice(10, 1050) // would produce a price exception if it ran
    const before = await matchFootprint(id)
    simulate('error')
    const response = await failure(match(id))
    expect(response.status).toBe(503)
    expect(response.data.error.code).toBe('S4_UNAVAILABLE')
    expect(JSON.stringify(response.data)).not.toMatch(/MOCK|internal error|stack/i)
    expect(await matchFootprint(id)).toEqual(before)
    expect((await SELECT.from('ap.Exceptions').where({ invoice_ID: id }))).toEqual([])

    const failed = (await logRowsFor(id)).filter(r => r.status === 'FAILED')
    expect(failed).toHaveLength(3)
    for (const row of failed)
      expect(row.errorMessage).toBe('MOCK S/4 error: the simulated system answered with an internal error')

    simulate('none')
    expect((await match(id)).data.status).toBe('EXCEPTION') // retry works
  })
})

describe('I2 - S/4 error during submit', () => {
  test('503, the draft stays intact and is not activated, FAILED rows are logged, retry works', async () => {
    const id = await draft()
    simulate('error')
    const response = await failure(submit(id))
    expect(response.status).toBe(503)
    expect(response.data.error.code).toBe('S4_UNAVAILABLE')

    expect(await statusOf(GET(activeUrl(id), CLERK))).toBe(404) // not activated
    const { data: kept } = await GET(`${draftUrl(id)}?$expand=items`, CLERK)
    expect(kept).toMatchObject({ supplierID: '1000020', purchaseOrder: '4500000901', supplierReference: `INT-${referenceCounter}` })
    expect(kept.items).toHaveLength(1)
    expect(await SELECT.from('ap.Invoices').where({ ID: id })).toEqual([])
    expect(await SELECT.from('ap.ApprovalHistory').where({ invoice_ID: id })).toEqual([])

    const rows = await logRowsFor(id)
    expect(rows.map(r => r.operation).sort()).toEqual(['getPurchaseOrder', 'getSupplier'])
    for (const row of rows) expect(row.status).toBe('FAILED')

    simulate('none')
    await submit(id)
    expect((await GET(activeUrl(id), CLERK)).data.status).toBe('VALIDATED')
  })

  test('a timeout during submit behaves the same', async () => {
    const id = await draft()
    useTimeout(SHORT_TIMEOUT); simulate('timeout')
    expect((await failure(submit(id))).status).toBe(503)
    expect(await statusOf(GET(activeUrl(id), CLERK))).toBe(404)
    expect(await statusOf(GET(draftUrl(id), CLERK))).toBe(200)
    for (const row of await logRowsFor(id)) expect(row).toMatchObject({ status: 'FAILED', errorMessage: `FACADE_TIMEOUT: Timeout after ${SHORT_TIMEOUT} ms` })
  })
})

describe('correlation IDs', () => {
  test('parallel requests never share or mix correlation IDs', async () => {
    const ids = await Promise.all([1, 2, 3].map(() => draft()))
    for (const id of ids) await submit(id)
    const submitted = (await logRows()).length
    await Promise.all(ids.map(id => match(id)))

    const rows = (await logRows()).slice(submitted)
    expect(rows).toHaveLength(9)
    const perInvoice = ids.map(id => new Set(rows.filter(r => r.invoice_ID === id).map(r => r.correlationID)))
    for (const set of perInvoice) expect(set.size).toBe(1)
    expect(new Set(perInvoice.map(set => [...set][0])).size).toBe(3)
  })
})

describe('R2 - parallel Match requests on one invoice', () => {
  test.each([1, 2, 3, 4, 5])('round %i: one succeeds, the other gets 409, exactly one run is written', async () => {
    const id = await validatedInvoice(10, 1050) // price exception: also checks exceptions are not duplicated
    const responses = await Promise.all([match(id), match(id)].map(p => p.then(r => r, e => e.response)))

    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    expect(responses.find(r => r.status === 409).data.error.code).toBe('INVALID_STATUS_TRANSITION')

    const { invoice, results, exceptions, history } = await matchFootprint(id)
    expect(invoice.status).toBe('EXCEPTION')
    expect(new Set(results.map(r => r.runID))).toEqual(new Set([invoice.lastMatchRunID]))
    expect(results).toHaveLength(1)
    expect(exceptions).toHaveLength(1)
    expect(history.map(h => h.action)).toEqual(['SUBMIT', 'MATCH'])
  })

  test('if the status changes between reading and writing, the compare-and-set refuses before anything is written', async () => {
    // Simulates the interleaving that row locks prevent on HANA: another request changes the
    // status after this request read it as VALIDATED (here: right before the engine runs).
    const id = await validatedInvoice()
    const engine = await cds.connect.to('MatchingEngine')
    let interfere = true
    engine.prepend(() => engine.before('evaluate', async () => {
      if (!interfere) return
      interfere = false
      await UPDATE('ap.Invoices').set({ status: 'BLOCKED' }).where({ ID: id })
    }))
    const response = await failure(match(id))
    expect(response.status).toBe(409)
    expect(response.data.error.code).toBe('INVALID_STATUS_TRANSITION')
    // the whole request is rolled back, including the interfering update in the same transaction
    const { invoice, results, exceptions, history } = await matchFootprint(id)
    expect(invoice).toMatchObject({ status: 'VALIDATED', lastMatchRunID: null })
    expect([results, exceptions]).toEqual([[], []])
    expect(history.map(h => h.action)).toEqual(['SUBMIT'])
    // the S/4 calls had succeeded and stay logged although the business request failed
    expect((await logRowsFor(id)).filter(r => r.status === 'SUCCESS')).toHaveLength(2 + 3)
  })
})

describe('Phase 5 and 6 behaviour stays intact', () => {
  test('a failed match does not change the ETag; status actions still go through the status machine', async () => {
    const id = await validatedInvoice()
    const etag = (await GET(activeUrl(id), CLERK)).headers.etag
    simulate('error')
    await failure(match(id))
    expect((await GET(activeUrl(id), CLERK)).headers.etag).toBe(etag)
    simulate('none')
    // stale ETag still refused, and the status machine still forbids release before match
    expect(await statusOf(POST(`${activeUrl(id)}/InvoiceService.match`, {}, { ...CLERK, headers: { 'If-Match': 'W/"stale"' } }))).toBe(412)
    expect((await failure(POST(`${activeUrl(id)}/InvoiceService.release`, {}, CLERK))).data.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  test('S/4 failures do not bypass authorization: a buyer still cannot match', async () => {
    const id = await validatedInvoice()
    simulate('error')
    expect(await statusOf(match(id, BUYER1))).toBe(403)
    expect(await logRowsFor(id)).toHaveLength(2) // only the submit calls: rejected before any S/4 call
  })
})

describe('Integration Log over OData (AdminService.MessageLog)', () => {
  test('AP Managers can read it, newest first; it cannot be written over OData', async () => {
    const id = await validatedInvoice()
    await match(id)
    const { data: { value } } = await GET(`${ADM}/MessageLog?$orderby=createdAt desc`, MANAGER)
    expect(value).toHaveLength(5)
    const [row] = value
    expect(await statusOf(POST(`${ADM}/MessageLog`, { operation: 'fake', status: 'SUCCESS' }, MANAGER))).toBe(405)
    expect(await statusOf(PATCH(`${ADM}/MessageLog(${row.ID})`, { status: 'FAILED' }, MANAGER))).toBe(405)
    expect(await statusOf(DELETE(`${ADM}/MessageLog(${row.ID})`, MANAGER))).toBe(405)
    expect((await GET(`${ADM}/MessageLog`, MANAGER)).data.value).toHaveLength(5)
    expect((await GET(`${ADM}/MessageLog(${row.ID})`, MANAGER)).data.status).toBe('SUCCESS')
  })

  test('filterable by correlation ID, status and operation', async () => {
    const id = await validatedInvoice()
    simulate('error')
    await failure(match(id))
    const [{ correlationID }] = (await logRowsFor(id)).filter(r => r.status === 'FAILED')
    const byCorrelation = (await GET(`${ADM}/MessageLog?$filter=correlationID eq ${correlationID}`, MANAGER)).data.value
    expect(byCorrelation).toHaveLength(3)
    expect((await GET(`${ADM}/MessageLog?$filter=status eq 'FAILED' and operation eq 'getSupplier'`, MANAGER)).data.value).toHaveLength(1)
  })

  test('searchable by correlation ID; shows the invoice number and a status criticality', async () => {
    const id = await validatedInvoice()
    await match(id)
    const [{ correlationID }] = (await logRowsFor(id)).slice(2)
    const { data: { value } } = await GET(`${ADM}/MessageLog?$search="${correlationID}"&$expand=invoice`, MANAGER)
    expect(value).toHaveLength(3)
    const { invoiceNumber } = await SELECT.one.from('ap.Invoices').columns('invoiceNumber').where({ ID: id })
    for (const row of value) expect(row).toMatchObject({ correlationID, statusCriticality: 3, invoice: { ID: id, invoiceNumber } })
    const second = await validatedInvoice()
    simulate('error')
    await failure(match(second))
    const failed = (await GET(`${ADM}/MessageLog?$filter=status eq 'FAILED'`, MANAGER)).data.value
    expect(failed.map(r => r.statusCriticality)).toEqual([1, 1, 1])
  })

  test('the invoice reference exposes only ID and number, to AP Managers only', async () => {
    await validatedInvoice()
    const { data: { value: [ref] } } = await GET(`${ADM}/InvoiceRefs`, MANAGER)
    expect(Object.keys(ref).sort()).toEqual(['ID', 'invoiceNumber'])
    expect(await statusOf(POST(`${ADM}/InvoiceRefs`, { invoiceNumber: 'X' }, MANAGER))).toBe(405)
    expect(await Promise.all([CLERK, BUYER1].map(user => statusOf(GET(`${ADM}/InvoiceRefs`, user))))).toEqual([403, 403])
  })

  test('AP Clerks, Buyers and users without a role get 403', async () => {
    expect(await Promise.all([CLERK, BUYER1, as('buyer2'), NOBODY].map(user => statusOf(GET(`${ADM}/MessageLog`, user)))))
      .toEqual([403, 403, 403, 403])
  })

  test('is not reachable through the invoice and exception services', async () => {
    const id = await validatedInvoice()
    for (const uri of [INV, EXC]) {
      expect((await GET(`${uri}/$metadata`, MANAGER)).data).not.toMatch(/MessageLog/)
      expect(await statusOf(GET(`${uri}/MessageLog`, MANAGER))).toBe(404)
    }
    expect(await statusOf(GET(`${activeUrl(id)}?$expand=messageLog`, CLERK))).toBe(400)
  })

  test('rows hold no payloads, credentials or personal data - only these columns', async () => {
    const id = await validatedInvoice()
    simulate('error')
    await failure(match(id))
    const [row] = (await GET(`${ADM}/MessageLog?$top=1`, MANAGER)).data.value
    expect(Object.keys(row).sort()).toEqual(['ID', 'correlationID', 'createdAt', 'direction', 'durationMs',
      'errorMessage', 'invoice_ID', 'operation', 'status', 'statusCriticality', 'targetSystem'])
    const all = JSON.stringify(await logRows())
    for (const sensitive of ['1000020', '4500000901', 'clerk1', 'INT-', 'password', 'Authorization'])
      expect(all).not.toContain(sensitive)
  })
})
