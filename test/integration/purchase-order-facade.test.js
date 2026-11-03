// Phase 1: the MOCK S/4 facade returns the shapes the rest of the app relies on.
const cds = require('@sap/cds')
const path = require('path')

cds.test(path.join(__dirname, '../..'))

describe('ExternalPurchaseOrderService (mock)', () => {
  let facade
  beforeAll(async () => {
    facade = await cds.connect.to('ExternalPurchaseOrderService')
  })

  test('runs the mock implementation, not a remote S/4 system', () => {
    expect(facade.constructor.name).toBe('MockPurchaseOrderService')
  })

  test('getPurchaseOrder returns the header with all items', async () => {
    const po = await facade.send('getPurchaseOrder', { purchaseOrder: '4500000101' })
    expect(po).toMatchObject({
      purchaseOrder: '4500000101',
      supplierID: '1000010',
      companyCode: '1010',
      purchasingGroup: '001',
      currency: 'INR',
      isDeleted: false
    })
    expect(po.items.map(i => i.item)).toEqual(['00010', '00020'])
    expect(po.items[0]).toMatchObject({ orderQuantity: 50, orderUnit: 'EA', netPrice: 1500, priceUnit: 1, grBasedIV: true })
  })

  test('getPurchaseOrder exposes priceUnit 100 and 2-way items unchanged', async () => {
    const paper = await facade.send('getPurchaseOrder', { purchaseOrder: '4500000103' })
    expect(paper.items[0]).toMatchObject({ netPrice: 450, priceUnit: 100 })
    const service = await facade.send('getPurchaseOrder', { purchaseOrder: '4500000105' })
    expect(service.items[0].grBasedIV).toBe(false)
  })

  test('net received quantity subtracts the 102 reversal', async () => {
    const received = await facade.send('getReceivedQuantities', { purchaseOrder: '4500000104' })
    const rod = received.find(r => r.purchaseOrderItem === '00010')
    expect(rod).toMatchObject({ receivedQuantity: 70, unit: 'KG' }) // 100 received - 30 reversed
  })

  test('PO item without goods receipt reports 0 received', async () => {
    const received = await facade.send('getReceivedQuantities', { purchaseOrder: '4500000103' })
    expect(received.find(r => r.purchaseOrderItem === '00020').receivedQuantity).toBe(0)
  })

  test('unknown PO is rejected with 404 PO_NOT_FOUND', async () => {
    await expect(facade.send('getPurchaseOrder', { purchaseOrder: '4599999999' }))
      .rejects.toMatchObject({ code: 'PO_NOT_FOUND', status: 404 })
  })

  test('posting-blocked supplier flag is returned', async () => {
    const blocked = await facade.send('getSupplier', { supplierID: '1000050' })
    expect(blocked.isPostingBlocked).toBe(true)
    const normal = await facade.send('getSupplier', { supplierID: '1000010' })
    expect(normal.isPostingBlocked).toBe(false)
  })

  test('searchSuppliers matches on ID or name, case-insensitively', async () => {
    const byName = await facade.send('searchSuppliers', { text: 'steel' })
    expect(byName.map(s => s.supplierID)).toEqual(['1000030'])
    const all = await facade.send('searchSuppliers', { text: '' })
    expect(all).toHaveLength(5)
  })

  test('searchPurchaseOrders filters by supplier and returns headers only', async () => {
    const pos = await facade.send('searchPurchaseOrders', { text: '', supplierID: '1000010' })
    expect(pos.map(p => p.purchaseOrder)).toEqual(['4500000101', '4500000102'])
    expect(pos[0]).toMatchObject({ companyCode: '1010', purchasingGroup: '001', currency: 'INR', items: [] })
    const byText = await facade.send('searchPurchaseOrders', { text: '0104', supplierID: null })
    expect(byText.map(p => p.purchaseOrder)).toEqual(['4500000104'])
  })

  test('listPurchaseOrderItems returns the items of one PO', async () => {
    const items = await facade.send('listPurchaseOrderItems', { purchaseOrder: '4500000104' })
    expect(items.map(i => [i.item, i.isDeleted])).toEqual([['00010', false], ['00020', true]])
  })
})
