// Phase 10: the ExternalPurchaseOrderService contract, run against BOTH implementations with
// the same expectations (facade-contract.mock.test.js, facade-contract.s4-adapter.test.js).
// The data behind both is the same business data: mock-data/s4mock (mock) and its SAP-shaped
// twin mock-data/s4api (adapter over CAP's local mocks of the official SAP APIs).
const cds = require('@sap/cds')

/** Exact field sets of the contract types (srv/external/purchase-order-facade.cds). */
const SHAPES = {
  Supplier: ['country', 'isPostingBlocked', 'name', 'supplierID'],
  PurchaseOrder: ['companyCode', 'currency', 'isDeleted', 'items', 'orderDate', 'purchaseOrder', 'purchasingGroup', 'supplierID'],
  PurchaseOrderItem: ['description', 'grBasedIV', 'isDeleted', 'item', 'material', 'netPrice', 'orderQuantity', 'orderUnit',
    'priceUnit', 'purchaseOrder'],
  ReceivedQuantity: ['purchaseOrder', 'purchaseOrderItem', 'receivedQuantity', 'unit']
}
const keysOf = object => Object.keys(object).sort()

/**
 * @param {object} impl  what differs by design: { className, targetSystem, country(supplierID) }
 */
module.exports = function facadeContract(impl) {
  let facade
  beforeAll(async () => { facade = await cds.connect.to('ExternalPurchaseOrderService') })
  const send = (event, data) => facade.send(event, data)
  const rejection = promise => promise.then(() => { throw new Error('expected a rejection') }, e => e)

  test('runs the expected implementation, behind the facade guard', () => {
    expect(facade.constructor.name).toBe(impl.className)
    expect(facade).toBeInstanceOf(require('../../srv/external/facade-service'))
  })

  describe('suppliers', () => {
    test('getSupplier maps ID, name, country and posting block', async () => {
      const supplier = await send('getSupplier', { supplierID: '1000010' })
      expect(keysOf(supplier)).toEqual(SHAPES.Supplier)
      expect(supplier).toEqual({ supplierID: '1000010', name: 'MOCK Acme Industrial Supplies', country: impl.country('1000010'), isPostingBlocked: false })
      expect(await send('getSupplier', { supplierID: '1000050' })).toMatchObject({ supplierID: '1000050', isPostingBlocked: true })
    })

    test('unknown supplier: 404 SUPPLIER_NOT_FOUND', async () => {
      expect(await rejection(send('getSupplier', { supplierID: '9999999' }))).toMatchObject({ status: 404, code: 'SUPPLIER_NOT_FOUND' })
    })

    test('searchSuppliers matches ID or name case-insensitively; empty text lists all', async () => {
      expect((await send('searchSuppliers', { text: 'steel' })).map(s => s.supplierID)).toEqual(['1000030'])
      expect((await send('searchSuppliers', { text: 'ACME' })).map(s => s.supplierID)).toEqual(['1000010'])
      expect((await send('searchSuppliers', { text: '00040' })).map(s => s.supplierID)).toEqual(['1000040'])
      expect(await send('searchSuppliers', { text: 'no such supplier' })).toEqual([])
      const all = await send('searchSuppliers', { text: '' })
      expect(all.map(s => s.supplierID)).toEqual(['1000010', '1000020', '1000030', '1000040', '1000050'])
      for (const s of all) expect(keysOf(s)).toEqual(SHAPES.Supplier)
    })
  })

  describe('purchase orders', () => {
    test('getPurchaseOrder: header with company code, purchasing group, currency and all items in item order', async () => {
      const po = await send('getPurchaseOrder', { purchaseOrder: '4500000101' })
      expect(keysOf(po)).toEqual(SHAPES.PurchaseOrder)
      expect(po).toMatchObject({ purchaseOrder: '4500000101', supplierID: '1000010', companyCode: '1010', purchasingGroup: '001',
        currency: 'INR', orderDate: '2026-09-01', isDeleted: false })
      expect(po.items).toEqual([
        { purchaseOrder: '4500000101', item: '00010', material: 'MAT-CHAIR-01', description: 'Office chair', orderQuantity: 50,
          orderUnit: 'EA', netPrice: 1500, priceUnit: 1, grBasedIV: true, isDeleted: false },
        { purchaseOrder: '4500000101', item: '00020', material: 'MAT-LAMP-01', description: 'Desk lamp', orderQuantity: 20,
          orderUnit: 'EA', netPrice: 800, priceUnit: 1, grBasedIV: true, isDeleted: false }
      ])
      expect(await send('getPurchaseOrder', { purchaseOrder: '4500000104' })).toMatchObject({ companyCode: '1020', purchasingGroup: '002' })
    })

    test('price unit: the price of 100 sheets stays 450 per 100, never 450 per sheet', async () => {
      const { items: [paper] } = await send('getPurchaseOrder', { purchaseOrder: '4500000103' })
      expect(paper).toMatchObject({ netPrice: 450, priceUnit: 100 })
    })

    test('2-way item (no goods-receipt-based invoice verification)', async () => {
      const { items: [service] } = await send('getPurchaseOrder', { purchaseOrder: '4500000105' })
      expect(service.grBasedIV).toBe(false)
    })

    test('deleted PO and deleted item are flagged, not hidden', async () => {
      expect(await send('getPurchaseOrder', { purchaseOrder: '4500000107' })).toMatchObject({ isDeleted: true })
      const items = await send('listPurchaseOrderItems', { purchaseOrder: '4500000104' })
      expect(items.map(i => [i.item, i.isDeleted])).toEqual([['00010', false], ['00020', true]])
      for (const i of items) expect(keysOf(i)).toEqual(SHAPES.PurchaseOrderItem)
    })

    test('unknown PO: 404 PO_NOT_FOUND from every PO operation', async () => {
      for (const event of ['getPurchaseOrder', 'listPurchaseOrderItems', 'getReceivedQuantities'])
        expect(await rejection(send(event, { purchaseOrder: '4599999999' }))).toMatchObject({ status: 404, code: 'PO_NOT_FOUND' })
    })

    test('searchPurchaseOrders: by supplier and by number, headers only', async () => {
      const pos = await send('searchPurchaseOrders', { text: '', supplierID: '1000010' })
      expect(pos.map(p => p.purchaseOrder)).toEqual(['4500000101', '4500000102'])
      expect(pos[0]).toMatchObject({ companyCode: '1010', purchasingGroup: '001', currency: 'INR', items: [] })
      expect(keysOf(pos[0])).toEqual(SHAPES.PurchaseOrder)
      expect((await send('searchPurchaseOrders', { text: '0104', supplierID: null })).map(p => p.purchaseOrder)).toEqual(['4500000104'])
      expect(await send('searchPurchaseOrders', { text: '4599', supplierID: null })).toEqual([])
    })
  })

  describe('goods receipts', () => {
    test('101 receipts per PO item, in the order unit', async () => {
      expect(await send('getReceivedQuantities', { purchaseOrder: '4500000101' })).toEqual([
        { purchaseOrder: '4500000101', purchaseOrderItem: '00010', receivedQuantity: 50, unit: 'EA' },
        { purchaseOrder: '4500000101', purchaseOrderItem: '00020', receivedQuantity: 20, unit: 'EA' }
      ])
    })

    test('102 reversal is subtracted: 100 received - 30 reversed = 70', async () => {
      const received = await send('getReceivedQuantities', { purchaseOrder: '4500000104' })
      expect(received.map(r => [r.purchaseOrderItem, r.receivedQuantity, r.unit])).toEqual([['00010', 70, 'KG'], ['00020', 0, 'KG']])
      for (const r of received) expect(keysOf(r)).toEqual(SHAPES.ReceivedQuantity)
    })

    test('items without any receipt report 0 (empty result is not an error)', async () => {
      const received = await send('getReceivedQuantities', { purchaseOrder: '4500000103' })
      expect(received.map(r => [r.purchaseOrderItem, r.receivedQuantity])).toEqual([['00010', 10000], ['00020', 0]])
      expect((await send('getReceivedQuantities', { purchaseOrder: '4500000105' }))[0].receivedQuantity).toBe(0)
    })
  })

  describe('facade guard', () => {
    afterEach(() => { cds.env.requires.ExternalPurchaseOrderService.timeout = 5000 })

    test('every call writes one MessageLog row with this implementation\'s target system', async () => {
      const before = (await SELECT.from('ap.MessageLog')).length
      await send('getSupplier', { supplierID: '1000010' })
      await rejection(send('getPurchaseOrder', { purchaseOrder: '4599999999' }))
      const rows = (await SELECT.from('ap.MessageLog').orderBy('createdAt', 'ID')).slice(before)
      expect(rows.map(r => [r.operation, r.status, r.targetSystem])).toEqual([
        ['getSupplier', 'SUCCESS', impl.targetSystem], ['getPurchaseOrder', 'SUCCESS', impl.targetSystem] // 404 is an answer
      ])
    })

    test('a failing backend becomes 503 S4_UNAVAILABLE, logged FAILED with a sanitized cause', async () => {
      const undo = impl.breakBackend('getSupplier', () => { throw new Error('backend down, see https://s4.example.com?token=abc') })
      const console = jest.spyOn(cds.log('s4-facade'), 'warn').mockImplementation(() => {})
      try {
        expect(await rejection(send('getSupplier', { supplierID: '1000010' }))).toMatchObject({ status: 503, code: 'S4_UNAVAILABLE' })
        // phase 11: the server console gets the same sanitized text, with the correlation ID
        expect(console).toHaveBeenCalledTimes(1)
        expect(console.mock.calls[0][0]).toMatch(new RegExp(`^${impl.targetSystem} getSupplier failed \\(correlation [0-9a-f-]{36}\\): .*backend down`))
        expect(console.mock.calls[0][0]).not.toMatch(/s4\.example\.com|abc/)
      } finally { undo(); console.mockRestore() }
      const [row] = await SELECT.from('ap.MessageLog').orderBy('createdAt desc', 'ID desc').limit(1)
      expect(row).toMatchObject({ operation: 'getSupplier', status: 'FAILED', targetSystem: impl.targetSystem })
      expect(row.errorMessage).toContain('backend down')
      expect(row.errorMessage).not.toMatch(/s4\.example\.com|abc/)
      expect(await send('getSupplier', { supplierID: '1000010' })).toMatchObject({ supplierID: '1000010' }) // recovers
    })

    test('a backend that does not answer is cut off by the timeout', async () => {
      cds.env.requires.ExternalPurchaseOrderService.timeout = 150
      const undo = impl.breakBackend('getSupplier', () => new Promise(() => {}))
      try {
        const started = Date.now()
        expect(await rejection(send('getSupplier', { supplierID: '1000010' }))).toMatchObject({ status: 503, code: 'S4_UNAVAILABLE' })
        expect(Date.now() - started).toBeLessThan(2000)
      } finally { undo() }
      const [row] = await SELECT.from('ap.MessageLog').orderBy('createdAt desc', 'ID desc').limit(1)
      expect(row).toMatchObject({ status: 'FAILED', errorMessage: 'FACADE_TIMEOUT: Timeout after 150 ms' })
    })
  })
}

module.exports.SHAPES = SHAPES
