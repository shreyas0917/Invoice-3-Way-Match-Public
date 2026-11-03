// Phase 10: facade contract (facade-contract.js) against the S/4 ADAPTER, with the official
// SAP APIs mocked locally by CAP (profile s4-adapter, SAP-shaped data in mock-data/s4api).
// No network and no SAP system: the adapter's real mapping code runs against CAP mocks.
const { available: SAP_MODELS, describeWithSapModels } = require('./sap-api-models')
if (SAP_MODELS) process.env.CDS_ENV = 's4-adapter' // selects the adapter; the [s4-adapter!] profile wins over [test]
const cds = require('@sap/cds')
const path = require('path')
const fs = require('fs')
const facadeContract = require('./facade-contract')

describeWithSapModels('S/4 adapter over the SAP API models', () => {
  const ROOT = path.join(__dirname, '../..')
  const { GET, POST, PATCH, axios } = cds.test('serve', 'all', '--with-mocks', '--in-memory').in(ROOT)
  axios.defaults.headers['If-Match'] = '*'
  afterAll(() => { delete process.env.CDS_ENV })

  // The adapter's backend is CAP's mock of API_BUSINESS_PARTNER: a breaker on its supplier reads.
  let breaker = null
  beforeAll(() => cds.services.API_BUSINESS_PARTNER.prepend(srv => srv.on('READ', (req, next) =>
    breaker && req.target?.name === 'API_BUSINESS_PARTNER.A_Supplier' ? breaker() : next())))

  describe('ExternalPurchaseOrderService contract - s4-adapter.js', () => facadeContract({
    className: 'S4Adapter',
    targetSystem: 'S4_CAP_MOCK',
    country: () => null, // A_Supplier has no country; not guessed (ADR 0008)
    breakBackend: (_, fn) => { breaker = fn; return () => { breaker = null } }
  }))

  describe('S/4 adapter: SAP data the mock cannot express', () => {
    let facade
    beforeAll(async () => { facade = await cds.connect.to('ExternalPurchaseOrderService') })
    const lastLogRow = async () => (await SELECT.from('ap.MessageLog').orderBy('createdAt desc', 'ID desc').limit(1))[0]
    const rejection = promise => promise.then(() => { throw new Error('expected a rejection') }, e => e)

    test('a cancelled receipt counts once: 101 (cancelled) 40 - 102 40 + 101 25 = 25', async () => {
      expect(await facade.send('getReceivedQuantities', { purchaseOrder: '4500000109' }))
        .toEqual([{ purchaseOrder: '4500000109', purchaseOrderItem: '00010', receivedQuantity: 25, unit: 'EA' }])
    })

    test('an unsupported movement type (122 return) is refused, not ignored', async () => {
      expect(await rejection(facade.send('getReceivedQuantities', { purchaseOrder: '4500000110' }))).toMatchObject({ status: 502, code: 'S4_DATA_UNSUPPORTED' }) // phase 11: not 503 - retrying cannot help
      expect(await lastLogRow()).toMatchObject({ operation: 'getReceivedQuantities', status: 'FAILED',
        errorMessage: 'UNSUPPORTED_MOVEMENT_TYPE: 122 in material document 2026/5000000011/0001' })
    })

    test('a price per a different unit than the order unit is refused, not converted by guesswork', async () => {
      expect(await rejection(facade.send('getPurchaseOrder', { purchaseOrder: '4500000108' }))).toMatchObject({ status: 502, code: 'S4_DATA_UNSUPPORTED' })
      expect((await lastLogRow()).errorMessage).toMatch(/^UNSUPPORTED_PRICE_UNIT: .*price per KG, ordered in EA/)
    })
  })

  describe('S/4 adapter: the application runs unchanged on it', () => {
    const INV = '/odata/v4/invoice'
    const CLERK = { auth: { username: 'clerk1', password: '' } }

    test('submit and match an invoice: same outcome as with the mock, calls logged per request', async () => {
      const { data: { ID } } = await POST(`${INV}/Invoices`, {}, CLERK)
      const draft = `${INV}/Invoices(ID=${ID},IsActiveEntity=false)`
      await PATCH(draft, { supplierID: '1000010', purchaseOrder: '4500000101', companyCode: '1010', currency_code: 'INR',
        supplierReference: 'S4-ADAPTER-1', invoiceDate: '2026-10-20', netAmount: 30000, taxAmount: 0, grossAmount: 30000 }, CLERK)
      await POST(`${draft}/items`, { purchaseOrderItem: '00010', quantity: 20, unit: 'EA', unitPrice: 1500, netAmount: 30000 }, CLERK)
      await POST(`${draft}/InvoiceService.draftActivate`, {}, CLERK)
      const { data } = await POST(`${INV}/Invoices(ID=${ID},IsActiveEntity=true)/InvoiceService.match`, {}, CLERK)
      expect(data.status).toBe('MATCHED')

      const [result] = await SELECT.from('ap.MatchResults').where({ invoice_ID: ID })
      expect(result).toMatchObject({ receivedQuantity: '50.000' }) // decimals are stored as text
      const rows = await SELECT.from('ap.MessageLog').where({ invoice_ID: ID }).orderBy('createdAt', 'ID')
      expect(rows.map(r => r.operation)).toEqual(expect.arrayContaining(['getSupplier', 'getPurchaseOrder', 'getReceivedQuantities']))
      expect(rows).toHaveLength(5) // submit 2 + match 3
      for (const row of rows) expect(row).toMatchObject({ status: 'SUCCESS', targetSystem: 'S4_CAP_MOCK' })
      expect(new Set(rows.slice(2).map(r => r.correlationID)).size).toBe(1)
    })

    test('phase 11: unsupported S/4 data during match - 502 S4_DATA_UNSUPPORTED, "retrying will not help", nothing written', async () => {
      const { data: { ID } } = await POST(`${INV}/Invoices`, {}, CLERK)
      const draft = `${INV}/Invoices(ID=${ID},IsActiveEntity=false)`
      await PATCH(draft, { supplierID: '1000040', purchaseOrder: '4500000110', companyCode: '1010', currency_code: 'INR',
        supplierReference: 'S4-ADAPTER-122', invoiceDate: '2026-10-20', netAmount: 800, taxAmount: 0, grossAmount: 800 }, CLERK)
      await POST(`${draft}/items`, { purchaseOrderItem: '00010', quantity: 1, unit: 'EA', unitPrice: 800, netAmount: 800 }, CLERK)
      await POST(`${draft}/InvoiceService.draftActivate`, {}, CLERK)
      const response = await POST(`${INV}/Invoices(ID=${ID},IsActiveEntity=true)/InvoiceService.match`, {}, CLERK).catch(e => e.response)
      expect(response.status).toBe(502)
      expect(response.data.error).toMatchObject({ code: 'S4_DATA_UNSUPPORTED' })
      expect(response.data.error.message).toMatch(/Retrying will not help/)
      expect(response.data.error.message).not.toMatch(/122|5000000011|movement type 1/)
      expect(await SELECT.one.from('ap.Invoices').columns('status').where({ ID })).toEqual({ status: 'VALIDATED' })
      expect(await SELECT.from('ap.MatchResults').where({ invoice_ID: ID })).toEqual([])
    })

    test('the mocked SAP APIs are not reachable over HTTP - for any role', async () => {
      for (const user of ['clerk1', 'buyer1', 'manager1'])
        for (const url of ['/odata/v4/api-business-partner/A_Supplier', '/odata/v4/api-purchaseorder-2/PurchaseOrder',
          '/odata/v4/api-material-document/A_MaterialDocumentItem', '/odata/v2/api-business-partner/A_Supplier'])
          expect(await GET(url, { auth: { username: user, password: '' } }).then(r => r.status, e => e.response?.status)).toBe(404)
    })

    test('read-only: the adapter source contains no write operation', () => {
      const source = fs.readFileSync(path.join(ROOT, 'srv/external/s4-adapter.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(source).not.toMatch(/\b(INSERT|UPSERT|UPDATE|DELETE)\b|\.(create|update|delete|insert|upsert|post|put|patch)\(/i)
      expect(source).not.toMatch(/\b(Cancel|CancelItem)\b/) // the Material Document API's write actions
    })
  })
})
