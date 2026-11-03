// Phase 4: the match action end to end - test catalogue M1-M5, P1-P2, Q1-Q3, G1, D3, T1-T5,
// plus run history, transactions and status guards. Fixtures: test/data (MOCK test POs
// 4500000901/902, company tolerance rules) and db/data (global defaults: price +2 %/500,
// -5 %/500; quantity 0 %/0; auto-release limit 1,00,000 INR).
const cds = require('@sap/cds')
const path = require('path')
const { Ratio } = require('../../srv/lib/decimal')

const { GET, POST, PATCH, data, axios } = cds.test(path.join(__dirname, '../..'))
// Since phase 5 Invoices carry an ETag: writes need If-Match (428 otherwise). Fiori sends it on
// every write; '*' stands in for it here. Stale-ETag behaviour is tested in status-machine tests.
axios.defaults.headers['If-Match'] = '*'

const BASE = '/odata/v4/invoice'
const AS_CLERK = { auth: { username: 'clerk1', password: '' } }
const draftOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=false)`
const activeOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=true)`

const GLOBAL_PRICE_RULE = 'a0000000-0000-4000-8000-000000000001'
const GLOBAL_QTY_RULE = 'a0000000-0000-4000-8000-000000000002'
const COMPANY_1020_PRICE_RULE = 'c0000000-0000-4000-8000-000000000001'

// Test PO 4500000901: supplier 1000020, company code 1010, purchasing group 001.
const PO_901 = { supplierID: '1000020', purchaseOrder: '4500000901', companyCode: '1010' }
const PO_902 = { supplierID: '1000030', purchaseOrder: '4500000902', companyCode: '1020' }

let referenceCounter = 0

/**
 * Submits (saves) a valid invoice with the given items and returns its ID.
 * Header amounts are derived from the items; tax 0.
 * @param items [{ poItem, quantity, price }]
 */
async function submit(items, { header = PO_901, invoiceDate = '2026-10-15', reference } = {}) {
  const net = items.reduce((sum, i) => sum.plus(Ratio.of(i.quantity).times(i.price)), Ratio.of(0)).toFixed(2)
  const { data: draft } = await POST(`${BASE}/Invoices`, {}, AS_CLERK)
  await PATCH(draftOf(draft.ID), {
    ...header, supplierReference: reference ?? `M-${++referenceCounter}`, invoiceDate,
    currency_code: 'INR', netAmount: net, taxAmount: 0, grossAmount: net
  }, AS_CLERK)
  for (const i of items)
    await POST(`${draftOf(draft.ID)}/items`, {
      purchaseOrderItem: i.poItem, quantity: i.quantity, unit: 'EA', unitPrice: i.price,
      netAmount: Ratio.of(i.quantity).times(i.price).toFixed(2)
    }, AS_CLERK)
  await POST(`${draftOf(draft.ID)}/InvoiceService.draftActivate`, {}, AS_CLERK)
  return draft.ID
}

/** Calls match and returns the invoice, its latest results, its exceptions and any warnings. */
async function match(id) {
  const response = await POST(`${activeOf(id)}/InvoiceService.match`, {}, AS_CLERK)
  return { ...(await state(id)), warnings: JSON.parse(response.headers['sap-messages'] ?? '[]').map(m => m.code) }
}

async function state(id) {
  const { data: invoice } = await GET(`${activeOf(id)}?$expand=items($orderby=itemNo),latestMatchResults,exceptions`, AS_CLERK)
  return {
    invoice,
    results: invoice.latestMatchResults,
    result: invoice.latestMatchResults[0],
    exceptions: invoice.exceptions,
    types: invoice.exceptions.map(e => e.type).sort()
  }
}

const submitAndMatch = (items, options) => submit(items, options).then(match)

/** Match that must fail; returns the HTTP status and error codes. */
async function matchRejected(id) {
  const error = await POST(`${activeOf(id)}/InvoiceService.match`, {}, AS_CLERK).then(
    () => { throw new Error('expected match to be rejected') }, e => e.response)
  const details = error.data.error.details ?? [error.data.error]
  return { status: error.status, codes: details.map(d => d.code) }
}

const db = () => cds.db
// Database tables, used to set up scenarios and to look behind the API.
const [MatchResults, Exceptions, ToleranceRules, ApprovalPolicies, Invoices] =
  ['ap.MatchResults', 'ap.Exceptions', 'ap.ToleranceRules', 'ap.ApprovalPolicies', 'ap.Invoices']

beforeEach(data.reset)

describe('M - matching outcomes', () => {
  test('M1 price, quantity and GR equal the PO: all items MATCHED, invoice MATCHED', async () => {
    // 100 x 1,000 = 1,00,000: exactly the auto-release limit, which is still allowed
    const { invoice, result, exceptions } = await submitAndMatch([{ poItem: '00010', quantity: 100, price: 1000 }])
    expect(invoice).toMatchObject({ status: 'MATCHED', approvalReason: null })
    expect(invoice.items[0].matchStatus).toBe('MATCHED')
    expect(result).toMatchObject({
      result: 'PASS', poQuantity: '100.000', poUnitPrice: '1000.0000', receivedQuantity: '100.000',
      previouslyInvoicedQty: '0.000', invoicedQuantity: '100.000', invoicedUnitPrice: '1000.00',
      priceVariancePct: '0.0000', priceVarianceAmount: '0.00', quantityVariance: '0.000',
      appliedPriceRule_ID: GLOBAL_PRICE_RULE, appliedQtyRule_ID: GLOBAL_QTY_RULE
    })
    expect(exceptions).toEqual([])
  })

  test('M2 fully matched but gross 2,50,000 is over the limit: PENDING_APPROVAL', async () => {
    const { invoice, exceptions } = await submitAndMatch([{ poItem: '00020', quantity: 10, price: 25000 }])
    expect(invoice).toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'OVER_AUTO_RELEASE_LIMIT', grossAmount: '250000.00' })
    expect(invoice.items[0].matchStatus).toBe('MATCHED')
    expect(exceptions).toEqual([])
  })

  test('M3 partial invoice (40 of 100 received) passes', async () => {
    const { invoice, result } = await submitAndMatch([{ poItem: '00010', quantity: 40, price: 1000 }])
    expect(invoice.status).toBe('MATCHED')
    expect(result).toMatchObject({ result: 'PASS', receivedQuantity: '100.000', quantityVariance: '-60.000' })
  })

  test('M4 2-way item (no GR-based IV, no GR) is matched against the PO quantity', async () => {
    const within = await submitAndMatch([{ poItem: '00040', quantity: 50, price: 200 }])
    expect(within.invoice.status).toBe('MATCHED')
    expect(within.result).toMatchObject({ result: 'PASS', receivedQuantity: '0.000', poQuantity: '50.000' })

    const over = await submitAndMatch([{ poItem: '00040', quantity: 1, price: 200 }]) // 50 already invoiced
    expect(over.types).toEqual(['QTY_VARIANCE'])
    expect(over.result.previouslyInvoicedQty).toBe('50.000')
  })

  test('M5 PO priceUnit 100: unit price = netPrice / 100 (15,000 / 100 = 150)', async () => {
    const { invoice, result } = await submitAndMatch([{ poItem: '00030', quantity: 100, price: 150 }])
    expect(invoice.status).toBe('MATCHED')
    expect(result).toMatchObject({ poUnitPrice: '150.0000', priceVariancePct: '0.0000' })
  })
})

describe('P - price', () => {
  test('P1 unit price 3 % above PO: PRICE_VARIANCE exception for the buyer', async () => {
    const { invoice, result, exceptions } = await submitAndMatch([{ poItem: '00010', quantity: 10, price: 1030 }])
    expect(invoice.status).toBe('EXCEPTION')
    expect(invoice.items[0].matchStatus).toBe('VARIANCE')
    expect(result).toMatchObject({ result: 'PRICE_VARIANCE', priceVariancePct: '3.0000', priceVarianceAmount: '300.00' })
    expect(exceptions).toEqual([expect.objectContaining({
      type: 'PRICE_VARIANCE', responsibleRole: 'BUYER', purchasingGroup: '001', varianceAmount: '300.00',
      status: 'OPEN', invoiceItem_ID: invoice.items[0].ID, matchResult_ID: result.ID, relatedInvoice_ID: null
    })])
  })

  test('P2 unit price 6 % below PO is beyond the lower limit (5 %): PRICE_VARIANCE', async () => {
    const { result, types } = await submitAndMatch([{ poItem: '00010', quantity: 5, price: 940 }])
    expect(types).toEqual(['PRICE_VARIANCE'])
    expect(result).toMatchObject({ priceVariancePct: '-6.0000', priceVarianceAmount: '-300.00' })
  })

  test('a price 4 % below PO within 500 passes the lower limits', async () => {
    const { invoice } = await submitAndMatch([{ poItem: '00010', quantity: 10, price: 960 }])
    expect(invoice.status).toBe('MATCHED')
  })
})

describe('Q - quantity', () => {
  test('Q1 invoiced 110, received 100: QTY_VARIANCE', async () => {
    const { result, exceptions } = await submitAndMatch([{ poItem: '00010', quantity: 110, price: 1000 }])
    expect(result).toMatchObject({ result: 'QTY_VARIANCE', quantityVariance: '10.000', appliedQtyRule_ID: GLOBAL_QTY_RULE })
    expect(exceptions).toEqual([expect.objectContaining({ type: 'QTY_VARIANCE', varianceAmount: '10000.00' })]) // 10 x 1,000
  })

  test('Q2 a second invoice on the same PO item pushes the total over the received quantity', async () => {
    const first = await submitAndMatch([{ poItem: '00070', quantity: 15, price: 800 }])
    expect(first.invoice.status).toBe('MATCHED')
    const second = await submitAndMatch([{ poItem: '00070', quantity: 10, price: 800 }])
    expect(second.types).toEqual(['QTY_VARIANCE'])
    expect(second.result).toMatchObject({ receivedQuantity: '20.000', previouslyInvoicedQty: '15.000', quantityVariance: '5.000' })
  })

  test('Q2 a cancelled invoice does not count as previously invoiced', async () => {
    const first = await submit([{ poItem: '00070', quantity: 15, price: 800 }])
    await UPDATE(Invoices, first).with({ status: 'CANCELLED' }) // what cancel will do in phase 5
    const second = await submitAndMatch([{ poItem: '00070', quantity: 10, price: 800 }])
    expect(second.invoice.status).toBe('MATCHED')
    expect(second.result.previouslyInvoicedQty).toBe('0.000')
  })

  test('Q3 GR 100 then reversal (102) of 30, invoiced 80: QTY_VARIANCE against net 70', async () => {
    const { result, types } = await submitAndMatch([{ poItem: '00060', quantity: 80, price: 500 }])
    expect(types).toEqual(['QTY_VARIANCE'])
    expect(result).toMatchObject({ receivedQuantity: '70.000', quantityVariance: '10.000' })
  })
})

describe('G - goods receipt', () => {
  test('G1 GR-based item without goods receipt: NO_GR (and no separate quantity exception)', async () => {
    const { invoice, result, exceptions } = await submitAndMatch([{ poItem: '00050', quantity: 5, price: 500 }])
    expect(invoice.status).toBe('EXCEPTION')
    expect(result).toMatchObject({ result: 'NO_GR', receivedQuantity: '0.000' })
    expect(exceptions).toEqual([expect.objectContaining({ type: 'NO_GR', responsibleRole: 'BUYER', varianceAmount: '2500.00' })])
  })
})

describe('D3 - suspect duplicate', () => {
  test('same supplier, date and gross amount with a different reference: DUPLICATE_SUSPECT for the AP Manager', async () => {
    const first = await submitAndMatch([{ poItem: '00010', quantity: 5, price: 1000 }], { invoiceDate: '2026-10-20', reference: 'D3-A' })
    expect(first.invoice.status).toBe('MATCHED')

    const second = await submitAndMatch([{ poItem: '00010', quantity: 5, price: 1000 }], { invoiceDate: '2026-10-20', reference: 'D3-B' })
    expect(second.invoice.status).toBe('EXCEPTION')
    expect(second.invoice.items[0].matchStatus).toBe('MATCHED') // the items themselves match
    expect(second.exceptions).toEqual([expect.objectContaining({
      type: 'DUPLICATE_SUSPECT', responsibleRole: 'AP_MANAGER', invoiceItem_ID: null, matchResult_ID: null,
      relatedInvoice_ID: first.invoice.ID, varianceAmount: '5000.00', status: 'OPEN'
    })])
  })

  test('a different gross amount or date is not a suspect duplicate', async () => {
    await submitAndMatch([{ poItem: '00010', quantity: 5, price: 1000 }], { invoiceDate: '2026-10-20' })
    const otherAmount = await submitAndMatch([{ poItem: '00010', quantity: 6, price: 1000 }], { invoiceDate: '2026-10-20' })
    const otherDate = await submitAndMatch([{ poItem: '00010', quantity: 5, price: 1000 }], { invoiceDate: '2026-10-21' })
    expect([otherAmount.invoice.status, otherDate.invoice.status]).toEqual(['MATCHED', 'MATCHED'])
  })
})

describe('T - tolerances', () => {
  test('T1 variance of exactly 2.00 % and 500: PASS (limits are inclusive)', async () => {
    const { invoice, result } = await submitAndMatch([{ poItem: '00010', quantity: 25, price: 1020 }])
    expect(invoice.status).toBe('MATCHED')
    expect(result).toMatchObject({ result: 'PASS', priceVariancePct: '2.0000', priceVarianceAmount: '500.00' })
  })

  test('T2 variance of 2.01 %: PRICE_VARIANCE', async () => {
    const { result } = await submitAndMatch([{ poItem: '00010', quantity: 1, price: 1020.1 }])
    expect(result).toMatchObject({ result: 'PRICE_VARIANCE', priceVariancePct: '2.0100' })
  })

  test('T3 variance of 1 % but 600 absolute: PRICE_VARIANCE (both limits must hold)', async () => {
    const { result } = await submitAndMatch([{ poItem: '00010', quantity: 60, price: 1010 }])
    expect(result).toMatchObject({ result: 'PRICE_VARIANCE', priceVariancePct: '1.0000', priceVarianceAmount: '600.00' })
  })

  test('T4 a company-specific rule (1020: 10 % / 5,000) overrides the global rule', async () => {
    const { invoice, result } = await submitAndMatch([{ poItem: '00010', quantity: 10, price: 1050 }], { header: PO_902 })
    expect(invoice.status).toBe('MATCHED') // 5 % would fail the global 2 %
    expect(result.appliedPriceRule_ID).toBe(COMPANY_1020_PRICE_RULE)
  })

  test('T5 a company rule that expired before the invoice date is not applied: global fallback', async () => {
    // company 1010 has a 10 % price rule valid only in 2025
    const { result } = await submitAndMatch([{ poItem: '00010', quantity: 10, price: 1050 }])
    expect(result).toMatchObject({ result: 'PRICE_VARIANCE', appliedPriceRule_ID: GLOBAL_PRICE_RULE })
  })

  test('an inactive company rule is ignored (1010 quantity rule with 50 %)', async () => {
    const { result } = await submitAndMatch([{ poItem: '00010', quantity: 110, price: 1000 }])
    expect(result).toMatchObject({ result: 'QTY_VARIANCE', appliedQtyRule_ID: GLOBAL_QTY_RULE })
  })

  test('without any tolerance rule zero tolerance applies and a warning is returned', async () => {
    await DELETE.from(ToleranceRules)
    const exact = await submitAndMatch([{ poItem: '00010', quantity: 10, price: 1000 }])
    expect(exact.invoice.status).toBe('MATCHED')
    expect(exact.result).toMatchObject({ appliedPriceRule_ID: null, appliedQtyRule_ID: null })
    expect(exact.warnings).toEqual(['NO_TOLERANCE_RULE', 'NO_TOLERANCE_RULE'])

    const offByOnePaisa = await submitAndMatch([{ poItem: '00010', quantity: 1, price: 1000.01 }])
    expect(offByOnePaisa.types).toEqual(['PRICE_VARIANCE'])
  })
})

describe('approval policy', () => {
  test('without an approval policy a fully matched invoice needs approval (safe default) and a warning is returned', async () => {
    await DELETE.from(ApprovalPolicies).where({ companyCode: '1010' })
    const { invoice, warnings } = await submitAndMatch([{ poItem: '00010', quantity: 1, price: 1000 }])
    expect(invoice).toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'NO_APPROVAL_POLICY' })
    expect(warnings).toEqual(['NO_APPROVAL_POLICY'])
  })

  test('a policy in another currency is never compared: approval needed', async () => {
    await UPDATE(ApprovalPolicies).set({ currency_code: 'EUR' }).where({ companyCode: '1010' })
    const { invoice, warnings } = await submitAndMatch([{ poItem: '00010', quantity: 1, price: 1000 }])
    expect(invoice).toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'POLICY_CURRENCY_MISMATCH' })
    expect(warnings).toEqual(['APPROVAL_POLICY_CURRENCY_MISMATCH'])
  })
})

describe('exceptions and match runs', () => {
  test('one item can fail price and quantity: two exceptions, result holds the first failure', async () => {
    const { result, exceptions } = await submitAndMatch([{ poItem: '00010', quantity: 110, price: 1030 }])
    expect(result.result).toBe('PRICE_VARIANCE')
    expect(exceptions.map(e => [e.type, e.varianceAmount, e.matchResult_ID]).sort()).toEqual([
      ['PRICE_VARIANCE', '3300.00', result.ID], // 30 x 110
      ['QTY_VARIANCE', '10000.00', result.ID] // 10 x 1,000
    ])
  })

  test('one run writes one result row per invoice item, all with the same runID', async () => {
    const { invoice, results } = await submitAndMatch([
      { poItem: '00010', quantity: 10, price: 1000 },
      { poItem: '00030', quantity: 10, price: 150 },
      { poItem: '00070', quantity: 2, price: 800 }
    ])
    expect(results).toHaveLength(3)
    expect(new Set(results.map(r => r.runID))).toEqual(new Set([invoice.lastMatchRunID]))
    expect(new Set(results.map(r => r.invoiceItem_ID))).toEqual(new Set(invoice.items.map(i => i.ID)))
  })

  test('a later run adds a new run and leaves earlier results untouched', async () => {
    const first = await submitAndMatch([{ poItem: '00010', quantity: 10, price: 1030 }])
    const firstRun = await SELECT.from(MatchResults).where({ invoice_ID: first.invoice.ID })

    // Simulate phase 5 REMATCH after the buyer corrected the PO price in S/4 (MOCK data).
    await UPDATE('s4mock.PurchaseOrderItems').set({ netPrice: 1030 }).where({ up__purchaseOrder: '4500000901', item: '00010' })
    await UPDATE(Invoices, first.invoice.ID).with({ status: 'VALIDATED' })
    const second = await match(first.invoice.ID)

    expect(second.invoice.status).toBe('MATCHED')
    expect(second.invoice.lastMatchRunID).not.toBe(first.invoice.lastMatchRunID)
    expect(second.result).toMatchObject({ poUnitPrice: '1030.0000', result: 'PASS' })
    expect(await SELECT.from(MatchResults).where({ runID: first.invoice.lastMatchRunID })).toEqual(firstRun)
    expect(await SELECT.from(MatchResults).where({ invoice_ID: first.invoice.ID })).toHaveLength(2)
  })

  test('a failure while saving rolls back results, exceptions and status together', async () => {
    const id = await submit([{ poItem: '00010', quantity: 10, price: 1030 }])
    let failExceptionInsert = true
    db().prepend(() => db().before('CREATE', Exceptions, () => {
      if (failExceptionInsert) throw new Error('simulated database failure')
    }))
    try {
      const error = await POST(`${activeOf(id)}/InvoiceService.match`, {}, AS_CLERK).catch(e => e.response)
      expect(error.status).toBe(500)
    } finally {
      failExceptionInsert = false
    }
    expect(await SELECT.from(MatchResults).where({ invoice_ID: id })).toEqual([])
    expect(await SELECT.from(Exceptions).where({ invoice_ID: id })).toEqual([])
    const { invoice } = await state(id)
    expect(invoice).toMatchObject({ status: 'VALIDATED', lastMatchRunID: null })
    expect(invoice.items[0].matchStatus).toBe('NOT_MATCHED')
  })
})

describe('status guard and re-validation', () => {
  test('only a VALIDATED invoice can be matched: a second match is rejected with 409', async () => {
    const id = await submit([{ poItem: '00010', quantity: 10, price: 1000 }])
    await match(id)
    expect(await matchRejected(id)).toEqual({ status: 409, codes: ['INVALID_STATUS_TRANSITION'] })
    expect(await SELECT.from(MatchResults).where({ invoice_ID: id })).toHaveLength(1)
  })

  test('a cancelled invoice cannot be matched', async () => {
    expect(await matchRejected('11111111-0000-4000-8000-000000000002')).toEqual({ status: 409, codes: ['INVALID_STATUS_TRANSITION'] })
  })

  test('a draft cannot be matched', async () => {
    const { data: draft } = await POST(`${BASE}/Invoices`, {}, AS_CLERK)
    const error = await POST(`${draftOf(draft.ID)}/InvoiceService.match`, {}, AS_CLERK).catch(e => e.response)
    expect(error).toMatchObject({ status: 409, data: { error: { code: 'MATCH_REQUIRES_SAVED_INVOICE' } } })
  })

  test('the PO is read again at match time: an item deleted in S/4 since submission stops the match', async () => {
    const id = await submit([{ poItem: '00070', quantity: 1, price: 800 }])
    await UPDATE('s4mock.PurchaseOrderItems').set({ isDeleted: true }).where({ up__purchaseOrder: '4500000901', item: '00070' })
    expect(await matchRejected(id)).toEqual({ status: 409, codes: ['PO_ITEM_DELETED'] })
    expect((await state(id)).invoice.status).toBe('VALIDATED')
    expect(await SELECT.from(MatchResults).where({ invoice_ID: id })).toEqual([])
  })
})
