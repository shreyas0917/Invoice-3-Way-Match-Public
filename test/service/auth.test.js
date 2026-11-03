// Phase 6: authorization - blueprint tests A1-A6 and the full role matrix, through real
// OData requests with CAP's mocked users (package.json, development/test profiles only):
//   clerk1, clerk2 (APClerk) - buyer1 (Buyer, group 001) - buyer2 (Buyer, group 002)
//   manager1 (APManager) - nobody (authenticated, no role)
// Fixtures: MOCK test POs 4500000901 (group 001) and 4500000902 (group 002) from test/data,
// invoice INV-2025-000001 created by manager1 (PENDING_APPROVAL) for the SoD test.
const cds = require('@sap/cds')
const path = require('path')
const { Ratio } = require('../../srv/lib/decimal')

const { GET, POST, PATCH, data, axios } = cds.test(path.join(__dirname, '../..'))
axios.defaults.headers['If-Match'] = '*' // Fiori sends the current ETag on every write

const INV = '/odata/v4/invoice', EXC = '/odata/v4/exception', ADM = '/odata/v4/admin'
const as = user => ({ auth: { username: user, password: '' } })
const CLERK = as('clerk1'), CLERK2 = as('clerk2'), BUYER1 = as('buyer1'), BUYER2 = as('buyer2'),
  MANAGER = as('manager1'), NOBODY = as('nobody')
const draftOf = id => `${INV}/Invoices(ID=${id},IsActiveEntity=false)`
const activeOf = id => `${INV}/Invoices(ID=${id},IsActiveEntity=true)`
const MANAGERS_OWN_INVOICE = '11111111-0000-4000-8000-000000000003'

/** HTTP status (and error code) of a request, whether it succeeds or not. */
const statusOf = promise => promise.then(r => r.status, e => e.response?.status ?? e.message)
const errorOf = promise => promise.then(
  r => ({ status: r.status }), e => ({ status: e.response?.status, code: e.response?.data?.error?.code }))

let referenceCounter = 0
const PO_001 = { supplierID: '1000020', purchaseOrder: '4500000901', companyCode: '1010' } // group 001
const PO_002 = { supplierID: '1000030', purchaseOrder: '4500000902', companyCode: '1020' } // group 002

/** Saves (as clerk1) and optionally matches an invoice; items: [[poItem, quantity, price]]. */
async function invoice(items, { header = PO_001, invoiceDate = '2026-10-15', match = true } = {}) {
  const net = items.reduce((s, [, q, p]) => s.plus(Ratio.of(q).times(p)), Ratio.of(0)).toFixed(2)
  const { data: draft } = await POST(`${INV}/Invoices`, {}, CLERK)
  await PATCH(draftOf(draft.ID), {
    ...header, currency_code: 'INR', supplierReference: `AUTH-${++referenceCounter}`, invoiceDate,
    netAmount: net, taxAmount: 0, grossAmount: net
  }, CLERK)
  for (const [poItem, quantity, price] of items)
    await POST(`${draftOf(draft.ID)}/items`, {
      purchaseOrderItem: poItem, quantity, unit: 'EA', unitPrice: price, netAmount: Ratio.of(quantity).times(price).toFixed(2)
    }, CLERK)
  await POST(`${draftOf(draft.ID)}/InvoiceService.draftActivate`, {}, CLERK)
  if (match) await POST(`${activeOf(draft.ID)}/InvoiceService.match`, {}, CLERK)
  return draft.ID
}

const exceptionsOf = async id => (await GET(`${EXC}/Exceptions?$filter=invoice_ID eq ${id}`, MANAGER)).data.value
const resolveUrl = id => `${EXC}/Exceptions(${id})/ExceptionService.resolve`
const resolve = (id, user, resolution = 'ACCEPT') => POST(resolveUrl(id), { resolution, note: 'checked' }, user)
const action = (id, name, body, user) => POST(`${activeOf(id)}/InvoiceService.${name}`, body ?? {}, user)

/**
 * Scenario shared by the buyer tests:
 *   group001: price variance on PO 4500000901 (purchasing group 001) -> BUYER exception
 *   group002: price variance on PO 4500000902 (purchasing group 002) -> BUYER exception
 *   duplicate: suspected duplicate on group 001 -> AP_MANAGER exception
 */
async function scenario() {
  const group001 = await invoice([['00010', 10, 1030]]) // +3 % > 2 % global rule
  const group002 = await invoice([['00010', 10, 1150]], { header: PO_002 }) // +15 % > 10 % company 1020 rule
  await invoice([['00010', 5, 1000]], { invoiceDate: '2026-10-20' })
  const duplicate = await invoice([['00010', 5, 1000]], { invoiceDate: '2026-10-20' }) // same date and gross
  const [e001] = await exceptionsOf(group001)
  const [e002] = await exceptionsOf(group002)
  const [eDup] = await exceptionsOf(duplicate)
  expect([e001.type, e001.purchasingGroup, e002.type, e002.purchasingGroup, eDup.type, eDup.responsibleRole])
    .toEqual(['PRICE_VARIANCE', '001', 'PRICE_VARIANCE', '002', 'DUPLICATE_SUSPECT', 'AP_MANAGER'])
  return { group001, group002, duplicate, e001, e002, eDup }
}

beforeEach(data.reset)

describe('blueprint tests A1-A6', () => {
  test('A1 buyer1 cannot read a group 002 exception: not listed, 404 by key', async () => {
    const { e002 } = await scenario()
    const { data } = await GET(`${EXC}/Exceptions`, BUYER1)
    expect(data.value.map(e => e.ID)).not.toContain(e002.ID)
    expect(await statusOf(GET(`${EXC}/Exceptions(${e002.ID})`, BUYER1))).toBe(404)
  })

  test('A2 buyer1 calling release is refused with 403', async () => {
    const id = await invoice([['00010', 10, 1000]]) // MATCHED
    expect(await statusOf(action(id, 'release', {}, BUYER1))).toBe(403)
  })

  test('A3 clerk1 calling approve is refused with 403', async () => {
    const id = await invoice([['00020', 10, 25000]]) // PENDING_APPROVAL
    expect(await statusOf(action(id, 'approve', {}, CLERK))).toBe(403)
  })

  test('A4 manager1 approving their own invoice: 403 SOD_SELF_APPROVAL', async () => {
    expect(await errorOf(action(MANAGERS_OWN_INVOICE, 'approve', {}, MANAGER))).toEqual({ status: 403, code: 'SOD_SELF_APPROVAL' })
    const { data } = await GET(activeOf(MANAGERS_OWN_INVOICE), CLERK)
    expect(data.status).toBe('PENDING_APPROVAL')
  })

  test('A5 nobody gets 403 from every service endpoint', async () => {
    const { e001, group001 } = await scenario()
    const requests = [
      GET(`${INV}/Invoices`, NOBODY), GET(`${INV}/MatchResults`, NOBODY), GET(`${INV}/ApprovalHistory`, NOBODY),
      GET(`${INV}/Suppliers`, NOBODY), GET(`${INV}/ChangeView`, NOBODY), GET(activeOf(group001), NOBODY),
      GET(`${INV}/checkDuplicates(supplierID='1000020',supplierReference='x',invoiceDate=2026-10-15,grossAmount=1)`, NOBODY),
      POST(`${INV}/Invoices`, {}, NOBODY), action(group001, 'block', { reason: 'x' }, NOBODY),
      GET(`${EXC}/Exceptions`, NOBODY), GET(`${EXC}/Invoices`, NOBODY), resolve(e001.ID, NOBODY),
      GET(`${ADM}/ToleranceRules`, NOBODY), GET(`${ADM}/ApprovalPolicies`, NOBODY), POST(`${ADM}/ApprovalPolicies`, {}, NOBODY)
    ]
    expect(await Promise.all(requests.map(statusOf))).toEqual(requests.map(() => 403))
  })

  test('A6 a buyer cannot resolve a DUPLICATE_SUSPECT exception, even in their own group', async () => {
    const { eDup } = await scenario()
    expect(eDup.purchasingGroup).toBe('001') // buyer1's group
    expect(await statusOf(resolve(eDup.ID, BUYER1))).toBe(403)
    expect((await GET(`${EXC}/Exceptions(${eDup.ID})`, MANAGER)).data.status).toBe('OPEN')
  })
})

describe('AP Clerk', () => {
  test('can create, edit and submit drafts, read all invoices, match, release and block', async () => {
    const id = await invoice([['00010', 10, 1000]], { match: false }) // created, edited, saved by clerk1
    expect((await action(id, 'match', {}, CLERK)).data.status).toBe('MATCHED')
    const { data: all } = await GET(`${INV}/Invoices?$filter=IsActiveEntity eq true`, CLERK)
    expect(all.value.map(i => i.ID)).toEqual(expect.arrayContaining([id, MANAGERS_OWN_INVOICE]))
    expect((await action(id, 'release', {}, CLERK)).data.status).toBe('RELEASED')
    const other = await invoice([['00010', 1, 1000]])
    expect((await action(other, 'block', { reason: 'dispute' }, CLERK2)).data.status).toBe('BLOCKED')
  })

  test('cannot approve, reject, unblock or cancel', async () => {
    const pending = await invoice([['00020', 10, 25000]])
    const blocked = await invoice([['00010', 1, 1000]])
    await action(blocked, 'block', { reason: 'x' }, CLERK)
    expect(await Promise.all([
      action(pending, 'approve', {}, CLERK), action(pending, 'reject', { reason: 'x' }, CLERK),
      action(blocked, 'unblock', { comment: 'x' }, CLERK), action(blocked, 'cancel', { reason: 'x' }, CLERK)
    ].map(statusOf))).toEqual([403, 403, 403, 403])
  })

  test('cannot use ExceptionService or AdminService', async () => {
    expect(await Promise.all([GET(`${EXC}/Exceptions`, CLERK), GET(`${ADM}/ToleranceRules`, CLERK), GET(`${ADM}/ApprovalPolicies`, CLERK)]
      .map(statusOf))).toEqual([403, 403, 403])
  })
})

describe('Buyer', () => {
  test('buyer1 and buyer2 each see only BUYER exceptions of their own group', async () => {
    const { e001, e002, eDup } = await scenario()
    const ids = async user => (await GET(`${EXC}/Exceptions`, user)).data.value.map(e => e.ID)
    expect(await ids(BUYER1)).toEqual([e001.ID]) // not group 002, not the AP_MANAGER duplicate
    expect(await ids(BUYER2)).toEqual([e002.ID])
    expect(await statusOf(GET(`${EXC}/Exceptions(${eDup.ID})`, BUYER1))).toBe(404)
  })

  test('a client-side filter cannot widen the server-side restriction', async () => {
    const { e001 } = await scenario()
    const sneaky = `$filter=purchasingGroup eq '002' or responsibleRole eq 'AP_MANAGER' or purchasingGroup eq '001'`
    expect((await GET(`${EXC}/Exceptions?${sneaky}`, BUYER1)).data.value.map(e => e.ID)).toEqual([e001.ID])
    expect((await GET(`${EXC}/Exceptions?$count=true&$top=0`, BUYER1)).data['@odata.count']).toBe(1)
  })

  test('related invoices, items, match results and history are visible only for the own group', async () => {
    const { group001, group002 } = await scenario()
    for (const set of ['Invoices', 'InvoiceItems', 'MatchResults', 'ApprovalHistory']) {
      const key = set === 'Invoices' ? 'ID' : set === 'InvoiceItems' ? 'up__ID' : 'invoice_ID'
      const { data } = await GET(`${EXC}/${set}`, BUYER1)
      expect(data.value.length).toBeGreaterThan(0)
      expect(data.value.some(row => row[key] === group002)).toBe(false)
      expect(data.value.some(row => row[key] === group001)).toBe(true)
    }
    expect(await statusOf(GET(`${EXC}/Invoices(${group002})`, BUYER1))).toBe(404)
    expect(await statusOf(GET(`${EXC}/Invoices(${group002})/exceptions`, BUYER1))).toBe(404)
    expect(await statusOf(GET(`${EXC}/Invoices(${group002})/matchResults`, BUYER1))).toBe(404)
  })

  test('navigating from an own-group invoice cannot reach AP_MANAGER exceptions or other rows', async () => {
    const { duplicate } = await scenario()
    expect((await GET(`${EXC}/Invoices(${duplicate})`, BUYER1)).status).toBe(200) // own group: visible
    // CAP does not filter expanded/navigated rows by the target's restriction, so these
    // associations are not exposed in ExceptionService at all.
    for (const path of ['?$expand=exceptions', '/exceptions', '?$expand=history', '/matchResults', '/latestMatchResults',
      "?$filter=exceptions/any(e:e/type eq 'DUPLICATE_SUSPECT')"])
      expect(await statusOf(GET(`${EXC}/Invoices(${duplicate})${path}`, BUYER1))).toBeGreaterThanOrEqual(400)
    expect(await statusOf(GET(`${EXC}/ApprovalHistory?$expand=exception`, BUYER1))).toBeGreaterThanOrEqual(400)
  })

  test('can resolve own-group PRICE_VARIANCE, QTY_VARIANCE and NO_GR exceptions', async () => {
    const price = await invoice([['00010', 10, 1030]])
    const quantity = await invoice([['00010', 110, 1000]])
    const noGR = await invoice([['00050', 5, 500]])
    for (const [id, resolution] of [[price, 'ACCEPT'], [quantity, 'REJECT'], [noGR, 'REMATCH']]) {
      const [exception] = await exceptionsOf(id)
      expect((await resolve(exception.ID, BUYER1, resolution)).data).toMatchObject({ status: 'RESOLVED', resolvedBy: 'buyer1' })
    }
  })

  test("cannot resolve another group's exception", async () => {
    const { e002 } = await scenario()
    expect([403, 404]).toContain(await statusOf(resolve(e002.ID, BUYER1)))
    expect((await GET(`${EXC}/Exceptions(${e002.ID})`, MANAGER)).data.status).toBe('OPEN')
    expect((await resolve(e002.ID, BUYER2)).status).toBe(200)
  })

  test('cannot change exceptions through generic CRUD', async () => {
    const { e001 } = await scenario()
    expect(await Promise.all([
      PATCH(`${EXC}/Exceptions(${e001.ID})`, { status: 'RESOLVED', resolution: 'ACCEPT' }, BUYER1),
      POST(`${EXC}/Exceptions`, { type: 'PRICE_VARIANCE' }, BUYER1),
      axios.delete(`${EXC}/Exceptions(${e001.ID})`, BUYER1),
      PATCH(`${EXC}/Invoices(${e001.invoice_ID})`, { status: 'RELEASED' }, BUYER1)
    ].map(statusOf))).toEqual([405, 405, 405, 405])
    expect((await GET(`${EXC}/Exceptions(${e001.ID})`, MANAGER)).data).toMatchObject({ status: 'OPEN', resolution: null })
  })

  test('cannot use InvoiceService or AdminService, and sees no change history', async () => {
    expect(await Promise.all([
      GET(`${INV}/Invoices`, BUYER1), POST(`${INV}/Invoices`, {}, BUYER1), GET(`${INV}/ChangeView`, BUYER1),
      GET(`${ADM}/ToleranceRules`, BUYER1), GET(`${EXC}/ChangeView`, BUYER1)
    ].map(statusOf))).toEqual([403, 403, 403, 403, 404]) // ExceptionService has no ChangeView at all
  })
})

describe('AP Manager', () => {
  test('reads all invoices, exceptions of every group and type, and all history', async () => {
    const { e001, e002, eDup } = await scenario()
    const exceptionIDs = (await GET(`${EXC}/Exceptions`, MANAGER)).data.value.map(e => e.ID)
    expect(exceptionIDs).toEqual(expect.arrayContaining([e001.ID, e002.ID, eDup.ID]))
    expect((await GET(`${INV}/Invoices?$filter=IsActiveEntity eq true`, MANAGER)).data.value.length).toBeGreaterThanOrEqual(5)
    expect((await GET(`${EXC}/ApprovalHistory`, MANAGER)).data.value.length).toBeGreaterThan(0)
    expect((await GET(`${activeOf(e001.invoice_ID)}/changes`, MANAGER)).data.value.length).toBeGreaterThan(0) // field change history
  })

  test('can match, release, approve, reject, block, unblock and cancel', async () => {
    const toMatch = await invoice([['00010', 10, 1000]], { match: false })
    expect((await action(toMatch, 'match', {}, MANAGER)).data.status).toBe('MATCHED')
    expect((await action(toMatch, 'release', {}, MANAGER)).data.status).toBe('RELEASED')
    const pending = await invoice([['00020', 10, 25000]])
    expect((await action(pending, 'approve', { comment: 'ok' }, MANAGER)).data.status).toBe('RELEASED')
    const toReject = await invoice([['00030', 1000, 150]]) // 1,50,000 over the limit, prices match
    expect((await action(toReject, 'reject', { reason: 'no budget' }, MANAGER)).data.status).toBe('BLOCKED')
    expect((await action(toReject, 'unblock', { comment: 'budget found' }, MANAGER)).data.status).toBe('VALIDATED')
    expect((await action(toReject, 'block', { reason: 'dispute' }, MANAGER)).data.status).toBe('BLOCKED')
    expect((await action(toReject, 'cancel', { reason: 'withdrawn' }, MANAGER)).data.status).toBe('CANCELLED')
  })

  test('can resolve every exception type, including suspected duplicates', async () => {
    const { e002, eDup } = await scenario()
    expect((await resolve(eDup.ID, MANAGER)).data.status).toBe('RESOLVED')
    expect((await resolve(e002.ID, MANAGER, 'REJECT')).data.status).toBe('RESOLVED')
  })

  test('cannot create or edit invoice drafts (AP Clerk only)', async () => {
    const id = await invoice([['00010', 1, 1000]], { match: false })
    expect(await Promise.all([
      POST(`${INV}/Invoices`, {}, MANAGER),
      POST(`${activeOf(id)}/InvoiceService.draftEdit`, { PreserveChanges: true }, MANAGER)
    ].map(statusOf))).toEqual([403, 403])
  })

  test('maintains tolerance rules (draft) and approval policies', async () => {
    const { data: draft } = await POST(`${ADM}/ToleranceRules`, {}, MANAGER)
    const url = `${ADM}/ToleranceRules(ID=${draft.ID},IsActiveEntity=false)`
    await PATCH(url, { companyCode: '1030', varianceType: 'PRICE', upperPercent: 1, lowerPercent: 1, upperAbsolute: 1, lowerAbsolute: 1, currency_code: 'INR', validFrom: '2026-01-01' }, MANAGER)
    expect((await POST(`${url}/AdminService.draftActivate`, {}, MANAGER)).status).toBe(201)
    expect((await POST(`${ADM}/ApprovalPolicies`, { companyCode: '1030', autoReleaseLimit: 5000, currency_code: 'INR' }, MANAGER)).status).toBe(201)
    expect((await PATCH(`${ADM}/ApprovalPolicies(b0000000-0000-4000-8000-000000001010)`, { autoReleaseLimit: 200000 }, MANAGER)).status).toBe(200)
  })
})

describe('alternate routes', () => {
  const batch = (service, user, url) => POST(`${service}/$batch`, { requests: [{ id: '1', method: 'GET', url }] },
    { ...user, headers: { 'Content-Type': 'application/json' } })

  test('service metadata is only served to roles that may use the service', async () => {
    expect(await Promise.all([
      GET(`${INV}/$metadata`, NOBODY), GET(`${INV}/$metadata`, BUYER1), GET(`${EXC}/$metadata`, CLERK),
      GET(`${ADM}/$metadata`, CLERK), GET(`${ADM}/$metadata`, BUYER1)
    ].map(statusOf))).toEqual([403, 403, 403, 403, 403])
    expect(await statusOf(GET(`${EXC}/$metadata`, BUYER1))).toBe(200)
  })

  test('$batch applies the same restrictions as single requests', async () => {
    const { e001 } = await scenario()
    expect(await statusOf(batch(INV, NOBODY, 'Invoices'))).toBe(403)
    expect(await statusOf(batch(INV, BUYER1, 'Invoices'))).toBe(403)
    const { data } = await batch(EXC, BUYER1, "Exceptions?$filter=purchasingGroup eq '002' or purchasingGroup eq '001'")
    expect(data.responses[0].body.value.map(e => e.ID)).toEqual([e001.ID])
  })

  test('internal services are not reachable over HTTP', async () => {
    expect(await Promise.all([
      GET('/odata/v4/matching-engine/$metadata', MANAGER), GET('/odata/v4/external-purchase-order/$metadata', MANAGER)
    ].map(statusOf))).toEqual([404, 404])
  })
})

describe('read-only and insert-only entities', () => {
  test('match results, exceptions, history and configuration cannot be written through InvoiceService', async () => {
    const id = await invoice([['00010', 10, 1030]])
    const [exception] = await exceptionsOf(id)
    const { data: results } = await GET(`${INV}/MatchResults`, CLERK)
    const { data: history } = await GET(`${INV}/ApprovalHistory`, CLERK)
    for (const user of [CLERK, MANAGER])
      expect(await Promise.all([
        PATCH(`${INV}/MatchResults(${results.value[0].ID})`, { result: 'PASS' }, user),
        POST(`${INV}/MatchResults`, {}, user),
        PATCH(`${INV}/Exceptions(${exception.ID})`, { status: 'RESOLVED' }, user),
        axios.delete(`${INV}/ApprovalHistory(${history.value[0].ID})`, user),
        POST(`${INV}/ToleranceRules`, {}, user)
      ].map(statusOf))).toEqual([405, 405, 405, 405, 405])
  })
})

describe('invoice items', () => {
  test('items are changed only through the invoice draft, by AP Clerks', async () => {
    const id = await invoice([['00010', 1, 1000]], { match: false })
    const { data: items } = await GET(`${activeOf(id)}/items`, CLERK)
    const itemUrl = `${INV}/InvoiceItems(ID=${items.value[0].ID},IsActiveEntity=true)`
    for (const user of [CLERK, MANAGER]) {
      const results = await Promise.all([
        PATCH(itemUrl, { quantity: 99 }, user), POST(`${INV}/InvoiceItems`, { up__ID: id, quantity: 1 }, user),
        POST(`${activeOf(id)}/items`, { quantity: 1 }, user)
      ].map(statusOf))
      for (const status of results) expect(status).toBeGreaterThanOrEqual(400)
    }
    expect((await GET(itemUrl, CLERK)).data.quantity).toBe('1.000')
  })
})

describe('user attribute safety (in-process, real CAP authorization)', () => {
  /** Reads ExceptionService.Exceptions as an ad-hoc user; CAP enforces @restrict for non-privileged users. */
  async function readAs(user) {
    const srv = await cds.connect.to('ExceptionService')
    return srv.tx({ user }, tx => tx.run(SELECT.from(srv.entities.Exceptions).columns('ID', 'purchasingGroup')))
  }

  test('a buyer without purchasingGroup sees nothing; changing the attribute changes the records', async () => {
    const { e001, e002 } = await scenario()
    expect(await readAs(new cds.User({ id: 'buyer-without-group', roles: ['Buyer'], attr: {} }))).toEqual([])
    expect((await readAs(new cds.User({ id: 'b', roles: ['Buyer'], attr: { purchasingGroup: '001' } }))).map(e => e.ID)).toEqual([e001.ID])
    expect((await readAs(new cds.User({ id: 'b', roles: ['Buyer'], attr: { purchasingGroup: '002' } }))).map(e => e.ID)).toEqual([e002.ID])
    expect(await readAs(new cds.User({ id: 'b', roles: ['Buyer'], attr: { purchasingGroup: '999' } }))).toEqual([])
  })

  test('the mocked users resolve to the expected roles and attributes', async () => {
    const users = cds.env.requires.auth.users
    // CAP's sample users (alice, bob, ...) are switched off one by one; '*': false refuses unknown names.
    const enabled = Object.entries(users).filter(([, u]) => u !== false).map(([name]) => name).sort()
    expect(enabled).toEqual(['buyer1', 'buyer2', 'clerk1', 'clerk2', 'manager1', 'nobody'])
    expect(users['*']).toBe(false)
    const roles = user => Object.keys(Array.isArray(user.roles) ? Object.fromEntries(user.roles.map(r => [r, 1])) : user.roles ?? {})
    expect(roles(users.buyer1)).toEqual(['Buyer'])
    expect(users.buyer1.attr).toEqual({ purchasingGroup: '001' })
    expect(users.buyer2.attr).toEqual({ purchasingGroup: '002' })
    expect(roles(users.nobody)).toEqual([])
    expect(await Promise.all(['alice', 'bob', 'me', 'someone'].map(u => statusOf(GET(`${INV}/Invoices`, as(u)))))).toEqual([401, 401, 401, 401])
  })
})
