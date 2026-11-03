// Unit tests for srv/lib/invoice-validation.js (rules V1-V10 without HTTP or database).
const { checkAmounts, checkAgainstPurchaseOrder } = require('../../srv/lib/invoice-validation')

const item = (over = {}) => ({ ID: 'i1', itemNo: 1, purchaseOrderItem: '00010', quantity: '20.000', unit: 'EA', unitPrice: '1500.00', netAmount: '30000.00', ...over })
const invoice = (over = {}) => ({
  supplierID: '1000010', purchaseOrder: '4500000101', companyCode: '1010', currency_code: 'INR', invoiceDate: '2026-10-15',
  netAmount: '30000.00', taxAmount: '5400.00', grossAmount: '35400.00', items: [item()], ...over
})
const supplier = { supplierID: '1000010', name: 'MOCK Acme', isPostingBlocked: false }
const po = {
  purchaseOrder: '4500000101', supplierID: '1000010', companyCode: '1010', currency: 'INR', orderDate: '2026-09-01', isDeleted: false,
  items: [{ item: '00010', orderUnit: 'EA', isDeleted: false }, { item: '00020', orderUnit: 'EA', isDeleted: true }]
}
const codes = issues => issues.map(i => i.code)

describe('checkAmounts (V1-V3)', () => {
  test('a consistent invoice has no issues', () => {
    expect(checkAmounts(invoice())).toEqual([])
  })

  test('V1 boundary: 0.01 off passes, 0.02 off fails', () => {
    expect(codes(checkAmounts(invoice({ grossAmount: '35400.01' })))).toEqual([])
    expect(codes(checkAmounts(invoice({ grossAmount: '35399.99' })))).toEqual([])
    expect(checkAmounts(invoice({ grossAmount: '35400.02' }))).toEqual([
      { code: 'INVOICE_GROSS_MISMATCH', field: 'grossAmount', args: ['35400.02', '35400.00'] }
    ])
  })

  test('V2 header net vs item sum', () => {
    const issues = checkAmounts(invoice({ items: [item(), item({ ID: 'i2', itemNo: 2, quantity: '1', unitPrice: '10', netAmount: '10' })] }))
    expect(issues).toEqual([{ code: 'INVOICE_NET_MISMATCH', field: 'netAmount', args: ['30000.00', '30010.00'] }])
  })

  test('V3 item net vs quantity times price, with fractional quantities', () => {
    // 0.333 x 5.00 = 1.665 -> 1.67 is within 0.01
    expect(checkAmounts(invoice({ netAmount: '1.67', taxAmount: '0.00', grossAmount: '1.67', items: [item({ quantity: '0.333', unitPrice: '5.00', netAmount: '1.67' })] }))).toEqual([])
    const [issue] = checkAmounts(invoice({ items: [item({ netAmount: '30000.02' })], netAmount: '30000.02', grossAmount: '35400.02' }))
    expect(issue).toEqual({ code: 'ITEM_NET_AMOUNT_MISMATCH', field: 'netAmount', itemID: 'i1', args: [1, '30000.02', '30000.00'] })
  })

  test('V3 no items and duplicate item numbers', () => {
    expect(codes(checkAmounts(invoice({ items: [] })))).toEqual(['INVOICE_NO_ITEMS'])
    const dup = checkAmounts(invoice({ netAmount: '60000.00', grossAmount: '65400.00', items: [item(), item({ ID: 'i2' })] }))
    expect(dup).toEqual([{ code: 'ITEM_NUMBER_DUPLICATE', field: 'itemNo', itemID: 'i2', args: [1] }])
  })

  test('missing values are left to @mandatory', () => {
    expect(checkAmounts(invoice({ grossAmount: null, items: [item({ quantity: null })] }))).toEqual([])
  })
})

describe('checkAgainstPurchaseOrder (V4-V10)', () => {
  test('a matching invoice has no issues', () => {
    expect(checkAgainstPurchaseOrder(invoice(), supplier, po)).toEqual([])
  })

  test('V4 unknown and blocked suppliers', () => {
    expect(codes(checkAgainstPurchaseOrder(invoice(), null, po))).toEqual(['SUPPLIER_NOT_FOUND'])
    expect(codes(checkAgainstPurchaseOrder(invoice(), { ...supplier, isPostingBlocked: true }, po))).toEqual(['SUPPLIER_POSTING_BLOCKED'])
  })

  test('V5 unknown or deleted PO stops the PO-based checks', () => {
    expect(codes(checkAgainstPurchaseOrder(invoice({ companyCode: 'XXXX' }), supplier, null))).toEqual(['PO_NOT_FOUND'])
    expect(codes(checkAgainstPurchaseOrder(invoice({ companyCode: 'XXXX' }), supplier, { ...po, isDeleted: true }))).toEqual(['PO_DELETED'])
  })

  test('V6-V8 header must agree with the PO', () => {
    const issues = checkAgainstPurchaseOrder(invoice({ supplierID: '1000020', companyCode: '1020', currency_code: 'EUR' }), supplier, po)
    expect(issues.map(i => [i.code, i.field])).toEqual([
      ['PO_SUPPLIER_MISMATCH', 'supplierID'], ['COMPANY_CODE_MISMATCH', 'companyCode'], ['CURRENCY_MISMATCH', 'currency_code']
    ])
  })

  test('V9 PO items: missing, deleted, unit mismatch', () => {
    const items = [item({ ID: 'a', purchaseOrderItem: '00099' }), item({ ID: 'b', purchaseOrderItem: '00020' }), item({ ID: 'c', unit: 'KG' })]
    expect(checkAgainstPurchaseOrder(invoice({ items }), supplier, po).map(i => [i.code, i.itemID, i.field])).toEqual([
      ['PO_ITEM_NOT_FOUND', 'a', 'purchaseOrderItem'], ['PO_ITEM_DELETED', 'b', 'purchaseOrderItem'], ['ITEM_UNIT_MISMATCH', 'c', 'unit']
    ])
  })

  test('V10 invoice date on the PO order date passes, the day before fails', () => {
    expect(checkAgainstPurchaseOrder(invoice({ invoiceDate: '2026-09-01' }), supplier, po)).toEqual([])
    expect(codes(checkAgainstPurchaseOrder(invoice({ invoiceDate: '2026-08-31' }), supplier, po))).toEqual(['INVOICE_DATE_BEFORE_PO_DATE'])
  })
})
