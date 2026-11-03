// Unit tests for srv/lib/matching.js: the pure 3-way matching engine.
const { evaluateInvoice, decideOutcome, RESPONSIBLE_ROLE } = require('../../srv/lib/matching')

const RULES = [
  { ID: 'gp', companyCode: null, varianceType: 'PRICE', upperPercent: '2.00', lowerPercent: '5.00', upperAbsolute: '500.00', lowerAbsolute: '500.00', currency_code: 'INR', validFrom: '2026-01-01', validTo: null, isActive: true },
  { ID: 'gq', companyCode: null, varianceType: 'QUANTITY', upperPercent: '0.00', lowerPercent: '0.00', upperAbsolute: '0.00', lowerAbsolute: '0.00', currency_code: 'INR', validFrom: '2026-01-01', validTo: null, isActive: true }
]
const POLICY = { companyCode: '1010', autoReleaseLimit: '100000.00', currency_code: 'INR' }
const PO = {
  purchaseOrder: '4500000901', purchasingGroup: '001',
  items: [
    { item: '00010', orderQuantity: 100, netPrice: 1000, priceUnit: 1, grBasedIV: true },
    { item: '00020', orderQuantity: 50, netPrice: 200, priceUnit: 1, grBasedIV: false },
    { item: '00030', orderQuantity: 20, netPrice: 500, priceUnit: 1, grBasedIV: true },
    { item: '00040', orderQuantity: 1000, netPrice: 15000, priceUnit: 100, grBasedIV: true }
  ]
}
const RECEIVED = [
  { purchaseOrderItem: '00010', receivedQuantity: 100 },
  { purchaseOrderItem: '00030', receivedQuantity: 0 },
  { purchaseOrderItem: '00040', receivedQuantity: 1000 }
]

const item = (no, poItem, quantity, unitPrice) => ({ ID: `i${no}`, itemNo: no, purchaseOrderItem: poItem, quantity, unitPrice })

function evaluate(items, over = {}) {
  const gross = over.grossAmount ?? items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0).toFixed(2)
  return evaluateInvoice({
    invoice: { ID: 'inv', companyCode: '1010', currency_code: 'INR', invoiceDate: '2026-10-15', grossAmount: gross, normalizedReference: 'REF1', items },
    purchaseOrder: PO, receivedQuantities: RECEIVED, invoicedQuantities: [], toleranceRules: RULES,
    approvalPolicy: POLICY, possibleDuplicates: [], ...over
  })
}

describe('evaluateInvoice', () => {
  test('a clean invoice: PASS rows with snapshots, MATCHED, no warnings', () => {
    const { items, exceptions, outcome, warnings } = evaluate([item(1, '00010', 10, 1000)])
    expect(items).toEqual([{
      invoiceItemID: 'i1', result: 'PASS', matchStatus: 'MATCHED',
      poQuantity: '100.000', poUnitPrice: '1000.0000', receivedQuantity: '100.000', previouslyInvoicedQty: '0.000',
      invoicedQuantity: '10.000', invoicedUnitPrice: '1000.00', priceVariancePct: '0.0000', priceVarianceAmount: '0.00',
      quantityVariance: '-90.000', appliedPriceRuleID: 'gp', appliedQtyRuleID: 'gq'
    }])
    expect(exceptions).toEqual([])
    expect(outcome).toEqual({ status: 'MATCHED', approvalReason: null })
    expect(warnings).toEqual([])
  })

  test('priceUnit 100: the unit price is netPrice / 100', () => {
    expect(evaluate([item(1, '00040', 10, 150)]).items[0]).toMatchObject({ poUnitPrice: '150.0000', result: 'PASS' })
  })

  test('price and quantity failures on one item: two exceptions, result = first failure', () => {
    const { items, exceptions, outcome } = evaluate([item(1, '00010', 110, 1030)])
    expect(items[0]).toMatchObject({ result: 'PRICE_VARIANCE', matchStatus: 'VARIANCE' })
    expect(exceptions).toEqual([
      { type: 'PRICE_VARIANCE', responsibleRole: 'BUYER', invoiceItemID: 'i1', purchasingGroup: '001', varianceAmount: '3300.00' },
      { type: 'QTY_VARIANCE', responsibleRole: 'BUYER', invoiceItemID: 'i1', purchasingGroup: '001', varianceAmount: '10000.00' }
    ])
    expect(outcome.status).toBe('EXCEPTION')
  })

  test('NO_GR replaces the quantity check for GR-based items without receipt', () => {
    const { items, exceptions } = evaluate([item(1, '00030', 5, 500)])
    expect(items[0]).toMatchObject({ result: 'NO_GR', receivedQuantity: '0.000' })
    expect(exceptions.map(e => [e.type, e.varianceAmount])).toEqual([['NO_GR', '2500.00']])
  })

  test('2-way items are matched against the ordered quantity and never get NO_GR', () => {
    expect(evaluate([item(1, '00020', 50, 200)]).items[0]).toMatchObject({ result: 'PASS', receivedQuantity: '0.000' })
    expect(evaluate([item(1, '00020', 51, 200)]).items[0].result).toBe('QTY_VARIANCE')
  })

  test('quantities on other invoices and on earlier lines of the same invoice reduce the open quantity', () => {
    const { items } = evaluate(
      [item(2, '00010', 30, 1000), item(1, '00010', 40, 1000)],
      { invoicedQuantities: [{ purchaseOrderItem: '00010', quantity: '20.000' }, { purchaseOrderItem: '00010', quantity: 5 }] }
    )
    // line 1: 100 - 25 = 75 open, 40 invoiced -> pass; line 2: 100 - 65 = 35 open, 30 invoiced -> pass
    expect(items.map(i => [i.invoiceItemID, i.previouslyInvoicedQty, i.result])).toEqual([['i1', '25.000', 'PASS'], ['i2', '65.000', 'PASS']])
    const over = evaluate([item(1, '00010', 60, 1000), item(2, '00010', 50, 1000)])
    expect(over.items.map(i => i.result)).toEqual(['PASS', 'QTY_VARIANCE'])
  })

  test('D3: same gross with a different reference is a header-level suspect duplicate', () => {
    const { exceptions, outcome } = evaluate([item(1, '00010', 5, 1000)], {
      possibleDuplicates: [
        { ID: 'other', invoiceNumber: 'INV-2026-000009', normalizedReference: 'REF2', grossAmount: '5000.00' },
        { ID: 'same-ref', invoiceNumber: 'INV-2026-000010', normalizedReference: 'REF1', grossAmount: '5000.00' },
        { ID: 'other-amount', invoiceNumber: 'INV-2026-000011', normalizedReference: 'REF3', grossAmount: '5000.01' }
      ]
    })
    expect(exceptions).toEqual([{
      type: 'DUPLICATE_SUSPECT', responsibleRole: 'AP_MANAGER', invoiceItemID: null, relatedInvoiceID: 'other',
      purchasingGroup: '001', varianceAmount: '5000.00'
    }])
    expect(outcome.status).toBe('EXCEPTION')
  })

  test('zero tolerance warnings when no rules exist', () => {
    const { warnings, items } = evaluate([item(1, '00010', 10, 1000)], { toleranceRules: [] })
    expect(warnings.map(w => w.code)).toEqual(['NO_TOLERANCE_RULE', 'NO_TOLERANCE_RULE'])
    expect(items[0]).toMatchObject({ result: 'PASS', appliedPriceRuleID: null, appliedQtyRuleID: null })
  })

  test('a PO item missing on the PO is a programming error (the caller re-validates first)', () => {
    expect(() => evaluate([item(1, '00099', 1, 1)])).toThrow('PO item 00099 not found')
  })

  test('missing goods receipt rows count as 0 received', () => {
    expect(evaluate([item(1, '00010', 1, 1000)], { receivedQuantities: [] }).items[0].result).toBe('NO_GR')
  })
})

describe('decideOutcome', () => {
  const invoice = (grossAmount, currency_code = 'INR') => ({ companyCode: '1010', currency_code, grossAmount })

  test('exceptions win over everything', () => {
    expect(decideOutcome({ invoice: invoice('1.00'), hasExceptions: true, policy: POLICY }).status).toBe('EXCEPTION')
  })

  test('the auto-release limit is inclusive', () => {
    expect(decideOutcome({ invoice: invoice('100000.00'), hasExceptions: false, policy: POLICY }).status).toBe('MATCHED')
    expect(decideOutcome({ invoice: invoice('100000.01'), hasExceptions: false, policy: POLICY }))
      .toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'OVER_AUTO_RELEASE_LIMIT', warnings: [] })
  })

  test('no policy or a policy in another currency: approval needed, with a warning', () => {
    expect(decideOutcome({ invoice: invoice('1.00'), hasExceptions: false, policy: null }))
      .toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'NO_APPROVAL_POLICY', warnings: [{ code: 'NO_APPROVAL_POLICY' }] })
    expect(decideOutcome({ invoice: invoice('1.00', 'EUR'), hasExceptions: false, policy: POLICY }))
      .toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'POLICY_CURRENCY_MISMATCH', warnings: [{ code: 'APPROVAL_POLICY_CURRENCY_MISMATCH' }] })
  })

  test('responsible roles per exception type', () => {
    expect(RESPONSIBLE_ROLE).toEqual({ PRICE_VARIANCE: 'BUYER', QTY_VARIANCE: 'BUYER', NO_GR: 'BUYER', DUPLICATE_SUSPECT: 'AP_MANAGER' })
  })
})
