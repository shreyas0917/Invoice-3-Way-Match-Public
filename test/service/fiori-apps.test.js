// Phase 7: the five Fiori elements apps - manifests and routing against the served metadata,
// the annotations the UI depends on, and the backend behind the new screens (Approval
// Queue, Integration Log, computed display fields, resolve value help).
const cds = require('@sap/cds')
const fs = require('fs')
const path = require('path')
const { Ratio } = require('../../srv/lib/decimal')

const { GET, POST, PATCH, data, axios } = cds.test(path.join(__dirname, '../..'))
axios.defaults.headers['If-Match'] = '*' // Fiori sends the current ETag on every write

const ROOT = path.join(__dirname, '../..')
const APPS = ['invoices', 'exceptions', 'approvals', 'tolerances', 'integration-log']
const INV = '/odata/v4/invoice', EXC = '/odata/v4/exception', ADM = '/odata/v4/admin'
const as = user => ({ auth: { username: user, password: '' } })
const CLERK = as('clerk1'), BUYER1 = as('buyer1'), MANAGER = as('manager1')
const statusOf = promise => promise.then(r => r.status, e => e.response?.status)

let referenceCounter = 0
async function invoice(items, { header = { supplierID: '1000020', purchaseOrder: '4500000901', companyCode: '1010' }, match = true } = {}) {
  const net = items.reduce((s, [, q, p]) => s.plus(Ratio.of(q).times(p)), Ratio.of(0)).toFixed(2)
  const { data: draft } = await POST(`${INV}/Invoices`, {}, CLERK)
  const draftUrl = `${INV}/Invoices(ID=${draft.ID},IsActiveEntity=false)`
  await PATCH(draftUrl, { ...header, currency_code: 'INR', supplierReference: `APP-${++referenceCounter}`, invoiceDate: '2026-10-15', netAmount: net, taxAmount: 0, grossAmount: net }, CLERK)
  for (const [poItem, quantity, price] of items)
    await POST(`${draftUrl}/items`, { purchaseOrderItem: poItem, quantity, unit: 'EA', unitPrice: price, netAmount: Ratio.of(quantity).times(price).toFixed(2) }, CLERK)
  await POST(`${draftUrl}/InvoiceService.draftActivate`, {}, CLERK)
  if (match) await POST(`${INV}/Invoices(ID=${draft.ID},IsActiveEntity=true)/InvoiceService.match`, {}, CLERK)
  return draft.ID
}

const manifestOf = app => JSON.parse(fs.readFileSync(path.join(ROOT, 'app', app, 'webapp', 'manifest.json'), 'utf8'))
const metadata = {}
async function metadataOf(uri) {
  metadata[uri] ??= (await GET(`${uri}$metadata`, MANAGER)).data
  return metadata[uri]
}

beforeEach(data.reset)

describe('app manifests and routing', () => {
  test.each(APPS)('%s: data source, entity sets, routes and views exist in the served metadata', async app => {
    const manifest = manifestOf(app)
    const uri = manifest['sap.app'].dataSources.mainService.uri
    const edmx = await metadataOf(uri)
    const { routes, targets } = manifest['sap.ui5'].routing
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      const target = targets[route.target]
      expect(target).toBeDefined()
      expect(target.name).toMatch(/^sap\.fe\.templates\.(ListReport|ObjectPage)$/)
      const entitySet = target.options.settings.contextPath.split('/')[1]
      expect(edmx).toContain(`<EntitySet Name="${entitySet}"`)
      for (const nav of Object.values(target.options.settings.navigation ?? {}))
        expect(routes.map(r => r.name)).toContain(nav.detail.route)
      for (const view of target.options.settings.views?.paths ?? []) {
        const qualifier = view.annotationPath.split('#')[1]
        if (qualifier) expect(edmx).toContain(`Term="UI.SelectionPresentationVariant" Qualifier="${qualifier}"`)
      }
    }
  })

  test('every app page fills the window and loads one pinned SAPUI5 version', () => {
    for (const app of APPS) {
      const html = fs.readFileSync(path.join(ROOT, 'app', app, 'webapp', 'index.html'), 'utf8')
      expect(html).toContain('#container-uiarea { height: 100%; }') // without it the app renders blank
      expect(html).toMatch(/ui5\.sap\.com\/1\.148\.\d+\/resources\/sap-ui-core\.js/)
    }
  })

  test('the launch page links all five apps', async () => {
    const { data: html } = await GET('/')
    for (const app of APPS) expect(html).toContain(`href="${app}/webapp/index.html"`)
  })

  // Phase 7 text said logging comes in phase 8; since phase 8 it explains where rows come from.
  test('the Integration Log explains its empty state', () => {
    const texts = fs.readFileSync(path.join(ROOT, 'app/integration-log/webapp/i18n/ListReport.properties'), 'utf8')
    expect(texts).toMatch(/T_TABLE_AND_CHART_NO_DATA_TEXT=No integration calls have been logged yet\. Every call to S\/4HANA/)
    expect(texts).toMatch(/T_TABLE_AND_CHART_NO_DATA_TEXT_WITH_FILTER=No integration calls match the filter/)
  })
})

describe('annotations the apps rely on', () => {
  test('invoice actions are offered only in the statuses the status machine allows', async () => {
    const edmx = await metadataOf(`${INV}/`)
    for (const action of ['match', 'release', 'approve', 'reject', 'block', 'unblock', 'cancel'])
      expect(edmx).toMatch(new RegExp(`Target="InvoiceService\\.${action}\\(InvoiceService\\.Invoices\\)"[\\s\\S]*?Core\\.OperationAvailable`))
    expect(edmx).toContain('<NavigationPropertyPath>/InvoiceService.EntityContainer/ApprovalQueue</NavigationPropertyPath>')
  })

  test('the resolve dialog: value help filtered by the exception type, only for OPEN exceptions', async () => {
    const edmx = await metadataOf(`${EXC}/`)
    expect(edmx).toContain('<PropertyValue Property="CollectionPath" String="AllowedResolutions"/>')
    expect(edmx).toContain('<PropertyValue Property="LocalDataProperty" PropertyPath="in/type"/>')
    expect(edmx).toMatch(/Target="ExceptionService\.resolve\(ExceptionService\.Exceptions\)"[\s\S]*?Core\.OperationAvailable/)
  })

  test('ToleranceRules are draft-enabled; the Integration Log is read-only', async () => {
    const edmx = await metadataOf(`${ADM}/`)
    expect(edmx).toMatch(/Target="AdminService\.EntityContainer\/ToleranceRules"[\s\S]*?Common\.DraftRoot/)
    expect(edmx).toMatch(/Target="AdminService\.EntityContainer\/MessageLog"[\s\S]*?Capabilities\.InsertRestrictions[\s\S]*?Insertable" Bool="false"/)
  })
})

describe('Approval Queue (InvoiceService.ApprovalQueue)', () => {
  test('lists only PENDING_APPROVAL invoices - fixed on the server, not by a UI filter', async () => {
    const pending = await invoice([['00020', 10, 25000]])
    await invoice([['00010', 1, 1000]]) // MATCHED
    const { data } = await GET(`${INV}/ApprovalQueue?$filter=status ne 'PENDING_APPROVAL' or status eq 'PENDING_APPROVAL'`, MANAGER)
    expect(data.value.map(i => [i.ID, i.status])).toEqual(expect.arrayContaining([[pending, 'PENDING_APPROVAL']]))
    expect(data.value.every(i => i.status === 'PENDING_APPROVAL')).toBe(true)
    expect(data.value.find(i => i.ID === pending)).toMatchObject({ approvalReason: 'OVER_AUTO_RELEASE_LIMIT', moneyAtStake: '0.00' })
  })

  test('is for AP Managers only', async () => {
    expect(await Promise.all([GET(`${INV}/ApprovalQueue`, CLERK), GET(`${INV}/ApprovalQueue`, BUYER1)].map(statusOf))).toEqual([403, 403])
    expect(await statusOf(GET(`${INV}/ApprovalQueue`, MANAGER))).toBe(200)
  })

  test('approve leaves the queue (204), keeps segregation of duties and writes history', async () => {
    const id = await invoice([['00020', 10, 25000]])
    expect(await statusOf(POST(`${INV}/ApprovalQueue(${id})/InvoiceService.approve`, { comment: 'ok' }, MANAGER))).toBe(204)
    const { data } = await GET(`${INV}/Invoices(ID=${id},IsActiveEntity=true)?$expand=history`, MANAGER)
    expect(data.status).toBe('RELEASED')
    expect(data.history.map(h => h.action)).toContain('APPROVE')
    expect(await statusOf(GET(`${INV}/ApprovalQueue(${id})`, MANAGER))).toBe(404)

    const own = '11111111-0000-4000-8000-000000000003' // created by manager1 (test/data)
    const error = await POST(`${INV}/ApprovalQueue(${own})/InvoiceService.approve`, {}, MANAGER).catch(e => e.response)
    expect(error).toMatchObject({ status: 403, data: { error: { code: 'SOD_SELF_APPROVAL' } } })
  })

  test('reject needs a reason; the queue is read-only otherwise', async () => {
    const id = await invoice([['00020', 10, 25000]])
    const error = await POST(`${INV}/ApprovalQueue(${id})/InvoiceService.reject`, {}, MANAGER).catch(e => e.response)
    expect(error).toMatchObject({ status: 400, data: { error: { code: 'REASON_REQUIRED' } } })
    expect(await statusOf(POST(`${INV}/ApprovalQueue(${id})/InvoiceService.reject`, { reason: 'no budget' }, MANAGER))).toBe(204)
    expect((await GET(`${INV}/Invoices(ID=${id},IsActiveEntity=true)`, MANAGER)).data).toMatchObject({ status: 'BLOCKED', blockReason: 'no budget' })
    expect(await Promise.all([
      PATCH(`${INV}/ApprovalQueue(${id})`, { status: 'RELEASED' }, MANAGER), POST(`${INV}/ApprovalQueue`, {}, MANAGER)
    ].map(statusOf))).toEqual([405, 405])
  })
})

describe('Integration Log (AdminService.MessageLog)', () => {
  // Phase 7 asserted an empty log (nothing was logged yet). Since phase 8 every facade call
  // writes one row, so the log holds exactly the real calls - still nothing invented.
  test('holds only real facade calls and is read-only for AP Managers only', async () => {
    expect((await GET(`${ADM}/MessageLog`, MANAGER)).data.value).toEqual([]) // no seed rows
    await invoice([['00010', 1, 1000]]) // calls the S/4 facade several times
    const rows = (await GET(`${ADM}/MessageLog`, MANAGER)).data.value
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toMatchObject({ direction: 'OUT', targetSystem: 'S4_MOCK', status: 'SUCCESS' })
    expect(await Promise.all([GET(`${ADM}/MessageLog`, CLERK), GET(`${ADM}/MessageLog`, BUYER1)].map(statusOf))).toEqual([403, 403])
    expect(await Promise.all([POST(`${ADM}/MessageLog`, { operation: 'fake' }, MANAGER)].map(statusOf))).toEqual([405])
  })

  test('is not exposed by the user-facing invoice and exception services', async () => {
    expect(await metadataOf(`${INV}/`)).not.toContain('EntitySet Name="MessageLog"')
    expect(await metadataOf(`${EXC}/`)).not.toContain('EntitySet Name="MessageLog"')
  })
})

describe('computed display fields', () => {
  test('money at stake = open exception amounts; rule texts; item currency', async () => {
    const id = await invoice([['00010', 110, 1030]]) // PRICE 3,300 + QTY 10,000 at stake
    const { data } = await GET(`${INV}/Invoices(ID=${id},IsActiveEntity=true)?$expand=latestMatchResults,items`, CLERK)
    expect(data.moneyAtStake).toBe('13300.00')
    expect(data.latestMatchResults[0]).toMatchObject({
      priceRuleText: 'Global: +2.00 % / -5.00 %, 500.00 / 500.00 INR',
      qtyRuleText: 'Global: +0.00 % / -0.00 %, 0.00 / 0.00 INR'
    })
    // navigation reads (as Fiori does) fill the computed fields as well
    const { data: items } = await GET(`${INV}/Invoices(ID=${id},IsActiveEntity=true)/items`, CLERK)
    expect(items.value[0].currency_code).toBe('INR')
    const { data: results } = await GET(`${INV}/Invoices(ID=${id},IsActiveEntity=true)/latestMatchResults`, CLERK)
    expect(results.value[0].priceRuleText).toMatch(/^Global/)
  })

  test('tolerance rules explain how they are applied', async () => {
    const { data } = await GET(`${ADM}/ToleranceRules?$filter=IsActiveEntity eq true`, MANAGER)
    expect(data.value[0].howRulesApply).toMatch(/within both the percentage limit and the absolute amount limit/)
  })
})

describe('resolve value help (ExceptionService.AllowedResolutions)', () => {
  test('lists exactly the resolutions the status machine allows per type', async () => {
    const byType = async type => (await GET(`${EXC}/AllowedResolutions?$filter=exceptionType eq '${type}'`, BUYER1)).data.value.map(r => r.resolution).sort()
    expect(await byType('NO_GR')).toEqual(['REJECT', 'REMATCH'])
    expect(await byType('DUPLICATE_SUSPECT')).toEqual(['ACCEPT', 'REJECT'])
    expect(await byType('PRICE_VARIANCE')).toEqual(['ACCEPT', 'REJECT', 'REMATCH'])
    expect(await statusOf(GET(`${EXC}/AllowedResolutions`, CLERK))).toBe(403)
  })
})
