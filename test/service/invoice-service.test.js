// Phase 2: InvoiceService draft lifecycle, draft ownership and facade-backed value helps.
const cds = require('@sap/cds')
const path = require('path')

const { GET, POST, PATCH, DELETE, data, axios } = cds.test(path.join(__dirname, '../..'))
// Since phase 5 Invoices carry an ETag: writes need If-Match (428 otherwise). Fiori sends it on
// every write; '*' stands in for it here. Stale-ETag behaviour is tested in status-machine tests.
axios.defaults.headers['If-Match'] = '*'

const BASE = '/odata/v4/invoice'
const as = user => ({ auth: { username: user, password: '' } })
const draftOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=false)`
const activeOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=true)`

/** Creates a draft with a filled header as `user` and returns its ID. */
async function newDraft(user = 'clerk1', header = {}) {
  const { data: draft } = await POST(`${BASE}/Invoices`, {}, as(user))
  await PATCH(draftOf(draft.ID), {
    supplierID: '1000010',
    supplierReference: 'INV-0100',
    invoiceDate: '2026-10-15',
    purchaseOrder: '4500000101',
    netAmount: 30000,
    taxAmount: 5400,
    grossAmount: 35400,
    ...header
  }, as(user))
  return draft.ID
}

const addItem = (id, item, user = 'clerk1') =>
  POST(`${draftOf(id)}/items`, item, as(user)).then(r => r.data)

const activate = (id, user = 'clerk1') =>
  POST(`${draftOf(id)}/InvoiceService.draftActivate`, {}, as(user)).then(r => r.data)

describe('InvoiceService - invoice drafts', () => {
  beforeEach(data.reset)

  test('AP Clerk can create an invoice draft with configured defaults', async () => {
    const { status, data: draft } = await POST(`${BASE}/Invoices`, {}, as('clerk1'))
    expect(status).toBe(201)
    expect(draft).toMatchObject({
      IsActiveEntity: false,
      HasActiveEntity: false,
      companyCode: '1010', // cds.invoiceWorkbench.defaults in package.json
      currency_code: 'INR',
      createdBy: 'clerk1'
    })
  })

  test('AP Clerk can edit the draft header', async () => {
    const id = await newDraft()
    await PATCH(draftOf(id), { supplierReference: 'INV-0046', taxAmount: 0 }, as('clerk1'))
    const { data: draft } = await GET(draftOf(id), as('clerk1'))
    expect(draft).toMatchObject({ supplierID: '1000010', supplierReference: 'INV-0046', purchaseOrder: '4500000101' })
    expect(Number(draft.taxAmount)).toBe(0)
  })

  test('AP Clerk can add items; item numbers are assigned 1, 2, ...', async () => {
    const id = await newDraft()
    const first = await addItem(id, { purchaseOrderItem: '00010', quantity: 20, unit: 'EA', unitPrice: 1500, netAmount: 30000 })
    const second = await addItem(id, { purchaseOrderItem: '00020', quantity: 5, unit: 'EA', unitPrice: 800, netAmount: 4000 })
    expect([first.itemNo, second.itemNo]).toEqual([1, 2])
    expect(first.up__ID).toBe(id)
    const { data } = await GET(`${draftOf(id)}/items`, as('clerk1'))
    expect(data.value).toHaveLength(2)
  })

  test('AP Clerk can activate the draft; the draft is gone, the active invoice has its items', async () => {
    const id = await newDraft()
    await addItem(id, { purchaseOrderItem: '00010', quantity: 20, unit: 'EA', unitPrice: 1500, netAmount: 30000 })
    const active = await activate(id)
    expect(active).toMatchObject({ ID: id, IsActiveEntity: true, HasDraftEntity: false, supplierReference: 'INV-0100' })

    const { data: invoice } = await GET(`${activeOf(id)}?$expand=items`, as('clerk1'))
    expect(invoice.items).toHaveLength(1)
    expect(invoice.items[0]).toMatchObject({ itemNo: 1, purchaseOrderItem: '00010', matchStatus: 'NOT_MATCHED' })

    await expect(GET(draftOf(id), as('clerk1'))).rejects.toMatchObject({ response: { status: 404 } })
  })

  test('items stay with the invoice they were added to', async () => {
    const a = await newDraft('clerk1', { supplierReference: 'A-1', netAmount: 1500, taxAmount: 0, grossAmount: 1500 })
    const b = await newDraft('clerk1', { supplierReference: 'B-1', netAmount: 6100, taxAmount: 0, grossAmount: 6100 })
    await addItem(a, { purchaseOrderItem: '00010', quantity: 1, unit: 'EA', unitPrice: 1500, netAmount: 1500 })
    await addItem(b, { purchaseOrderItem: '00020', quantity: 2, unit: 'EA', unitPrice: 800, netAmount: 1600 })
    await addItem(b, { purchaseOrderItem: '00010', quantity: 3, unit: 'EA', unitPrice: 1500, netAmount: 4500 })
    await activate(a)
    await activate(b)

    const { data } = await GET(`${BASE}/Invoices?$filter=supplierReference in ('A-1','B-1')&$expand=items($orderby=itemNo)&$orderby=supplierReference`, as('clerk1'))
    expect(data.value.map(i => [i.supplierReference, i.items.map(x => x.purchaseOrderItem)]))
      .toEqual([['A-1', ['00010']], ['B-1', ['00020', '00010']]])
    for (const invoice of data.value) for (const item of invoice.items) expect(item.up__ID).toBe(invoice.ID)
  })

  test('an activated invoice can be edited again through a new draft', async () => {
    const id = await newDraft()
    await addItem(id, { purchaseOrderItem: '00010', quantity: 20, unit: 'EA', unitPrice: 1500, netAmount: 30000 })
    await activate(id)
    await POST(`${activeOf(id)}/InvoiceService.draftEdit`, { PreserveChanges: true }, as('clerk1'))
    await PATCH(draftOf(id), { supplierReference: 'INV-0100-B' }, as('clerk1'))
    await activate(id)
    const { data } = await GET(activeOf(id), as('clerk1'))
    expect(data.supplierReference).toBe('INV-0100-B')
  })

  test('a draft can be discarded', async () => {
    const id = await newDraft()
    await DELETE(draftOf(id), as('clerk1'))
    const { data } = await GET(`${BASE}/Invoices?$filter=IsActiveEntity eq false`, as('clerk1'))
    expect(data.value).toHaveLength(0)
  })
})

describe('InvoiceService - draft ownership', () => {
  beforeEach(data.reset)

  test("another user's draft is not listed", async () => {
    const id = await newDraft('clerk1')
    const { data: own } = await GET(`${BASE}/Invoices?$filter=IsActiveEntity eq false`, as('clerk1'))
    expect(own.value.map(i => i.ID)).toEqual([id])
    const { data: other } = await GET(`${BASE}/Invoices?$filter=IsActiveEntity eq false`, as('clerk2'))
    expect(other.value).toHaveLength(0)
  })

  test("another user cannot change, extend or activate someone else's draft", async () => {
    const id = await newDraft('clerk1')
    const locked = { response: { status: 403 } }
    await expect(PATCH(draftOf(id), { supplierReference: 'HACK' }, as('clerk2'))).rejects.toMatchObject(locked)
    await expect(addItem(id, { quantity: 1 }, 'clerk2')).rejects.toMatchObject(locked)
    await expect(activate(id, 'clerk2')).rejects.toMatchObject(locked)

    const { data } = await GET(draftOf(id), as('clerk1'))
    expect(data.supplierReference).toBe('INV-0100')
  })

  test('unauthenticated requests are rejected', async () => {
    await expect(GET(`${BASE}/Invoices`)).rejects.toMatchObject({ response: { status: 401 } })
  })
})

describe('InvoiceService - value helps via ExternalPurchaseOrderService', () => {
  test('supplier value help searches through the facade', async () => {
    const { data } = await GET(`${BASE}/Suppliers?$search=steel&$count=true`, as('clerk1'))
    expect(data['@odata.count']).toBe(1)
    expect(data.value[0]).toMatchObject({ supplierID: '1000030', isPostingBlocked: false })
  })

  test('supplier value help validates a typed-in key, and unknown keys give 404', async () => {
    const { data } = await GET(`${BASE}/Suppliers('1000050')`, as('clerk1'))
    expect(data.isPostingBlocked).toBe(true)
    await expect(GET(`${BASE}/Suppliers('9999999')`, as('clerk1'))).rejects.toMatchObject({ response: { status: 404 } })
  })

  test('purchase order value help filters by supplier and returns header fields', async () => {
    const { data } = await GET(`${BASE}/PurchaseOrders?$filter=supplierID eq '1000010'&$orderby=purchaseOrder desc`, as('clerk1'))
    expect(data.value.map(p => p.purchaseOrder)).toEqual(['4500000102', '4500000101'])
    expect(data.value[0]).toMatchObject({ companyCode: '1010', currency_code: 'INR', purchasingGroup: '001' })
  })

  test('PO item value help lists the items of one PO with the unit price as a hint', async () => {
    const { data } = await GET(`${BASE}/PurchaseOrderItems?$filter=purchaseOrder eq '4500000103'&$top=1&$count=true`, as('clerk1'))
    expect(data['@odata.count']).toBe(2)
    expect(data.value).toHaveLength(1)
    expect(data.value[0]).toMatchObject({ item: '00010', orderUnit: 'EA', netPrice: 450, priceUnit: 100, unitPrice: 4.5 })
  })

  test('PO item value help is empty until a PO is chosen', async () => {
    const { data } = await GET(`${BASE}/PurchaseOrderItems`, as('clerk1'))
    expect(data.value).toEqual([])
  })

  test('value-help entities are read-only', async () => {
    await expect(POST(`${BASE}/Suppliers`, { supplierID: 'X' }, as('clerk1')))
      .rejects.toMatchObject({ response: { status: 405 } })
  })

  test('mock S/4 tables and the facade are not exposed over HTTP', async () => {
    const { data: metadata } = await GET(`${BASE}/$metadata`, as('clerk1'))
    expect(metadata).not.toMatch(/s4mock|ExternalPurchaseOrderService/)
    await expect(GET('/odata/v4/external-purchase-order/$metadata', as('clerk1')))
      .rejects.toMatchObject({ response: { status: 404 } })
  })
})
