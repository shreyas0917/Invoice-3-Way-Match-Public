// Phase 10: the S/4 adapter through CAP's real OData clients (RemoteService, kinds odata and
// odata-v2) against a FAKE SAP server on localhost - no SAP system, no external network.
// Verifies what the in-process mocks cannot: the OData URLs CAP builds from the adapter's
// queries (V4 and V2 syntax), that only GET is used, V2 response parsing (d.results, decimals
// as strings) and how an SAP error response surfaces (503, sanitized log).
const http = require('http')

const requests = []
let failSuppliers = false
const fakeSap = http.createServer((req, res) => {
  requests.push({ method: req.method, url: decodeURIComponent(req.url) })
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  const v2 = results => json(200, { d: { results } })
  const [, api, entitySet] = req.url.match(/^\/(\w+)\/(\w+)/) ?? []
  if (api === 'bp' && entitySet === 'A_Supplier') {
    if (failSuppliers) return json(500, { error: { code: 'SY/530', message: { lang: 'en', value: 'Internal error at https://s4.example.com/sap?sap-client=100 password=Secret1' } } })
    return v2([{ __metadata: { type: 'API_BUSINESS_PARTNER.A_SupplierType' }, Supplier: '1000010', SupplierName: 'Acme Remote', PostingIsBlocked: false }])
  }
  if (api === 'po' && entitySet === 'PurchaseOrder') return json(200, { '@odata.context': '$metadata#PurchaseOrder', value: [{
    PurchaseOrder: '4500000101', Supplier: '1000010', CompanyCode: '1010', PurchasingGroup: '001', DocumentCurrency: 'INR',
    PurchaseOrderDate: '2026-09-01', PurchaseOrderDeletionCode: '',
    _PurchaseOrderItem: [
      { PurchaseOrder: '4500000101', PurchaseOrderItem: '00020', Material: 'M-2', PurchaseOrderItemText: 'Paper', OrderQuantity: 1000,
        PurchaseOrderQuantityUnit: 'EA', NetPriceAmount: 450, NetPriceQuantity: 100, OrderPriceUnit: 'EA', InvoiceIsGoodsReceiptBased: true, PurchasingDocumentDeletionCode: '' },
      { PurchaseOrder: '4500000101', PurchaseOrderItem: '00010', Material: 'M-1', PurchaseOrderItemText: 'Chair', OrderQuantity: 50,
        PurchaseOrderQuantityUnit: 'EA', NetPriceAmount: 1500, NetPriceQuantity: 1, OrderPriceUnit: 'EA', InvoiceIsGoodsReceiptBased: true, PurchasingDocumentDeletionCode: '' }
    ]
  }] })
  if (api === 'md' && entitySet === 'A_MaterialDocumentItem') return v2([
    { MaterialDocumentYear: '2026', MaterialDocument: '5000000001', MaterialDocumentItem: '1', GoodsMovementType: '101', PurchaseOrder: '4500000101',
      PurchaseOrderItem: '00010', QuantityInEntryUnit: '50.000', EntryUnit: 'EA', QuantityInBaseUnit: '50.000', MaterialBaseUnit: 'EA' },
    { MaterialDocumentYear: '2026', MaterialDocument: '5000000002', MaterialDocumentItem: '1', GoodsMovementType: '102', PurchaseOrder: '4500000101',
      PurchaseOrderItem: '00010', QuantityInEntryUnit: '12.500', EntryUnit: 'EA', QuantityInBaseUnit: '12.500', MaterialBaseUnit: 'EA' }
  ])
  json(404, { error: { code: '404', message: 'unexpected request in test' } })
})
const { available: SAP_MODELS, describeWithSapModels } = require('./sap-api-models')
const url = path => `http://localhost:${fakeSap.address().port}/${path}`

// Credentials make CAP call the services remotely. CDS_CONFIG because the service names contain
// underscores, which the cds_requires_<name>_... environment variable syntax cannot express.
// Only with the SAP API models: without them nothing is started and no environment is changed.
if (SAP_MODELS) {
  fakeSap.listen(0)
  process.env.CDS_ENV = 's4-adapter'
  process.env.CDS_CONFIG = JSON.stringify({ requires: {
    API_PURCHASEORDER_2: { credentials: { url: url('po') } },
    API_MATERIAL_DOCUMENT: { credentials: { url: url('md') } },
    API_BUSINESS_PARTNER: { credentials: { url: url('bp') } }
  } })
}
const cds = require('@sap/cds')
const path = require('path')

describeWithSapModels('S/4 adapter through real OData clients against a fake SAP server', () => {
  cds.test('serve', 'all', '--with-mocks', '--in-memory').in(path.join(__dirname, '../..'))
  afterAll(() => { delete process.env.CDS_ENV; delete process.env.CDS_CONFIG; fakeSap.close() })

  let facade
  beforeAll(async () => { facade = await cds.connect.to('ExternalPurchaseOrderService') })
  beforeEach(() => { requests.length = 0 })
  const lastLogRow = async () => (await SELECT.from('ap.MessageLog').orderBy('createdAt desc', 'ID desc').limit(1))[0]

  test('with credentials the SAP APIs are remote; MessageLog says S4', async () => {
    for (const name of ['API_PURCHASEORDER_2', 'API_MATERIAL_DOCUMENT', 'API_BUSINESS_PARTNER'])
      expect(await cds.connect.to(name)).toBeInstanceOf(cds.RemoteService)
    await facade.send('getSupplier', { supplierID: '1000010' })
    expect(await lastLogRow()).toMatchObject({ operation: 'getSupplier', status: 'SUCCESS', targetSystem: 'S4' })
  })

  test('getSupplier: OData V2 request with $filter and only the needed fields; d.results parsed', async () => {
    expect(await facade.send('getSupplier', { supplierID: '1000010' }))
      .toEqual({ supplierID: '1000010', name: 'Acme Remote', country: null, isPostingBlocked: false })
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url).toMatch(/^\/bp\/A_Supplier\?/)
    expect(requests[0].url).toContain("$filter=Supplier eq '1000010'")
    expect(requests[0].url).toContain('$select=Supplier,SupplierName,PostingIsBlocked')
  })

  test('searchSuppliers: V2 has no contains() - CAP sends substringof() with tolower()', async () => {
    await facade.send('searchSuppliers', { text: 'Steel' })
    expect(requests[0].url).toContain("substringof('steel',tolower(SupplierName))")
    expect(requests[0].url).toContain('$top=200')
  })

  test('getPurchaseOrder: one OData V4 request with $expand of the items; items sorted, price unit kept', async () => {
    const po = await facade.send('getPurchaseOrder', { purchaseOrder: '4500000101' })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toMatch(/^\/po\/PurchaseOrder\?/)
    expect(requests[0].url).toContain('$expand=_PurchaseOrderItem($select=')
    expect(requests[0].url).toContain("$filter=PurchaseOrder eq '4500000101'")
    expect(po.items.map(i => [i.item, i.netPrice, i.priceUnit])).toEqual([['00010', 1500, 1], ['00020', 450, 100]])
  })

  test('getReceivedQuantities: V2 decimals arrive as strings - 50.000 - 12.500 = 37.5', async () => {
    expect(await facade.send('getReceivedQuantities', { purchaseOrder: '4500000101' })).toEqual([
      { purchaseOrder: '4500000101', purchaseOrderItem: '00010', receivedQuantity: 37.5, unit: 'EA' },
      { purchaseOrder: '4500000101', purchaseOrderItem: '00020', receivedQuantity: 0, unit: 'EA' }
    ])
    expect(requests.map(r => r.url.split('?')[0]).sort()).toEqual(['/md/A_MaterialDocumentItem', '/po/PurchaseOrder'])
  })

  test('only GET requests are ever sent (read-only)', async () => {
    await facade.send('getSupplier', { supplierID: '1000010' })
    await facade.send('searchPurchaseOrders', { text: '45', supplierID: '1000010' })
    await facade.send('listPurchaseOrderItems', { purchaseOrder: '4500000101' })
    await facade.send('getReceivedQuantities', { purchaseOrder: '4500000101' })
    expect(new Set(requests.map(r => r.method))).toEqual(new Set(['GET']))
  })

  test('an SAP error response: 503 S4_UNAVAILABLE for the caller; the log keeps no URL or password', async () => {
    failSuppliers = true
    try {
      await expect(facade.send('getSupplier', { supplierID: '1000010' })).rejects.toMatchObject({ status: 503, code: 'S4_UNAVAILABLE' })
    } finally { failSuppliers = false }
    const row = await lastLogRow()
    expect(row).toMatchObject({ operation: 'getSupplier', status: 'FAILED', targetSystem: 'S4' })
    expect(row.errorMessage).not.toMatch(/s4\.example\.com|sap-client|Secret1|localhost/)
  })
})
