// Phase 10: the S/4 adapter's mapping rules in isolation (srv/external/s4-adapter.js).
const cds = require('@sap/cds')
const { toSupplier, toPurchaseOrderHeader, toPurchaseOrderItem, receivedQuantities, checkConfiguration, UnsupportedS4Data, SAP_SERVICES } =
  require('../../srv/external/s4-adapter').internals

const sapItem = (overrides = {}) => ({
  PurchaseOrder: '4500000001', PurchaseOrderItem: '00010', Material: 'M-1', PurchaseOrderItemText: 'Item', OrderQuantity: '10.000',
  PurchaseOrderQuantityUnit: 'EA', NetPriceAmount: '450.00', NetPriceQuantity: '100', OrderPriceUnit: 'EA',
  InvoiceIsGoodsReceiptBased: true, PurchasingDocumentDeletionCode: '', ...overrides
})
const po = { purchaseOrder: '4500000001', items: [{ item: '00010', orderUnit: 'EA' }, { item: '00020', orderUnit: 'KG' }] }
const move = (doc, type, item, quantity, extra = {}) => ({
  MaterialDocumentYear: '2026', MaterialDocument: doc, MaterialDocumentItem: '0001', GoodsMovementType: type,
  PurchaseOrderItem: item, QuantityInEntryUnit: quantity, EntryUnit: item === '00010' ? 'EA' : 'KG',
  QuantityInBaseUnit: quantity, MaterialBaseUnit: item === '00010' ? 'EA' : 'KG', ...extra
})
const net = movements => Object.fromEntries(receivedQuantities(po, movements).map(r => [r.purchaseOrderItem, r.receivedQuantity]))

describe('supplier', () => {
  test('PostingIsBlocked is the posting block; a missing flag is not blocked; country is not guessed', () => {
    expect(toSupplier({ Supplier: '1', SupplierName: 'A', PostingIsBlocked: true })).toEqual({ supplierID: '1', name: 'A', country: null, isPostingBlocked: true })
    expect(toSupplier({ Supplier: '1', SupplierName: null }).isPostingBlocked).toBe(false)
  })
})

describe('purchase order', () => {
  test('header: any deletion code marks the PO deleted', () => {
    const header = { PurchaseOrder: '1', Supplier: 'S', CompanyCode: '1010', PurchasingGroup: '001', DocumentCurrency: 'INR', PurchaseOrderDate: '2026-01-01' }
    expect(toPurchaseOrderHeader({ ...header, PurchaseOrderDeletionCode: '' }).isDeleted).toBe(false)
    expect(toPurchaseOrderHeader({ ...header, PurchaseOrderDeletionCode: 'L' })).toMatchObject({ isDeleted: true, currency: 'INR', supplierID: 'S' })
  })

  test('item: V4 decimals as strings become numbers; price stays per price unit', () => {
    expect(toPurchaseOrderItem(sapItem())).toEqual({ purchaseOrder: '4500000001', item: '00010', material: 'M-1', description: 'Item',
      orderQuantity: 10, orderUnit: 'EA', netPrice: 450, priceUnit: 100, grBasedIV: true, isDeleted: false })
  })

  test.each(['L', 'S'])('item deletion code %s (deleted / blocked) is not invoiceable', code => {
    expect(toPurchaseOrderItem(sapItem({ PurchasingDocumentDeletionCode: code })).isDeleted).toBe(true)
  })

  test('an empty order price unit means the order unit', () => {
    expect(toPurchaseOrderItem(sapItem({ OrderPriceUnit: '' })).priceUnit).toBe(100)
  })

  test('a price per another unit, or a price quantity of 0, is refused', () => {
    expect(() => toPurchaseOrderItem(sapItem({ OrderPriceUnit: 'KG' }))).toThrow(UnsupportedS4Data)
    expect(() => toPurchaseOrderItem(sapItem({ NetPriceQuantity: '0' }))).toThrow(/INVALID_PRICE_UNIT|price quantity/)
  })
})

describe('received quantities', () => {
  test('no movements: 0 for every item', () => {
    expect(net([])).toEqual({ '00010': 0, '00020': 0 })
  })

  test('several 101 items add up; 102 subtracts; per item', () => {
    expect(net([move('A', '101', '00010', 10), move('B', '101', '00010', 5), move('C', '102', '00010', 3), move('D', '101', '00020', '2.500')]))
      .toEqual({ '00010': 12, '00020': 2.5 })
  })

  test('a cancelled 101 and its 102 cancel out - the reversal is not counted twice', () => {
    expect(net([move('A', '101', '00010', 40, { GoodsMovementIsCancelled: true }),
      move('B', '102', '00010', 40, { ReversedMaterialDocument: 'A', ReversedMaterialDocumentItem: '0001' })])).toEqual({ '00010': 0, '00020': 0 })
  })

  test('the same material document item delivered twice counts once', () => {
    const receipt = move('A', '101', '00010', 7)
    expect(net([receipt, { ...receipt }])).toEqual({ '00010': 7, '00020': 0 })
  })

  test('exact decimal arithmetic (no floating point drift)', () => {
    expect(net([move('A', '101', '00020', '0.1'), move('B', '101', '00020', '0.2')])['00020']).toBe(0.3)
  })

  test('quantity in another entry unit: the base quantity is used when the base unit is the order unit', () => {
    expect(net([move('A', '101', '00010', 2, { EntryUnit: 'BOX', QuantityInEntryUnit: 2, QuantityInBaseUnit: 24, MaterialBaseUnit: 'EA' })]))
      .toEqual({ '00010': 24, '00020': 0 })
    expect(() => net([move('A', '101', '00010', 2, { EntryUnit: 'BOX', MaterialBaseUnit: 'PAL' })])).toThrow(/UNSUPPORTED_UNIT|BOX/)
  })

  test.each(['122', '103', '105', '161', '201'])('movement type %s is refused, never ignored', type => {
    expect(() => net([move('A', type, '00010', 1)])).toThrow(UnsupportedS4Data)
  })

  test('movements for items that are not on the PO are ignored', () => {
    expect(net([move('A', '101', '00099', 9)])).toEqual({ '00010': 0, '00020': 0 })
  })
})

describe('configuration', () => {
  const requires = cds.env.requires
  const saved = {}
  beforeEach(() => { for (const name of Object.values(SAP_SERVICES)) saved[name] = requires[name] })
  afterEach(() => { for (const name of Object.values(SAP_SERVICES)) requires[name] = saved[name] })
  const configure = credentials => Object.values(SAP_SERVICES).forEach((name, i) =>
    requires[name] = { kind: 'odata', model: 'srv/external/s4-apis', ...(credentials[i] ? { credentials: { url: 'https://example.invalid' } } : {}) })

  test('missing SAP service configuration is an explicit error naming the profile', () => {
    for (const name of Object.values(SAP_SERVICES)) delete requires[name]
    expect(() => checkConfiguration()).toThrow(/cds.requires.API_PURCHASEORDER_2 is not configured.*s4-adapter/)
  })

  test('local mocks (no credentials) and remote (all credentials) are recognised', () => {
    configure([false, false, false]); expect(checkConfiguration()).toBe(false)
    configure([true, true, true]); expect(checkConfiguration()).toBe(true)
  })

  test('a mix of remote and mocked SAP APIs is refused', () => {
    configure([true, false, true])
    expect(() => checkConfiguration()).toThrow(/must all have credentials/)
  })

  test('production without credentials is refused - never local mocks in production', () => {
    configure([false, false, false])
    expect(() => checkConfiguration(['production'])).toThrow(/no credentials .* in production/)
    configure([true, true, true])
    expect(checkConfiguration(['production'])).toBe(true)
  })
})
