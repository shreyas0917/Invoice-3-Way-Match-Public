// Phase 5: status actions, exception resolution, ApprovalHistory, change tracking, ETags.
// Test catalogue S1-S6, R1, R3, H1 plus the action rules. Fixtures: test/data (MOCK test
// PO 4500000901, supplier 1000020, company code 1010) and the db/data default tolerances.
const cds = require('@sap/cds')
const path = require('path')
const { Ratio } = require('../../srv/lib/decimal')

const { GET, POST, PATCH, data, axios } = cds.test(path.join(__dirname, '../..'))
axios.defaults.headers['If-Match'] = '*' // Fiori sends the current ETag; '*' unless a test says otherwise

const BASE = '/odata/v4/invoice'
const EXC = '/odata/v4/exception'
const as = user => ({ auth: { username: user, password: '' } })
// Since phase 6 each call is made by the role allowed to make it: clerk1 enters, matches,
// releases and blocks; buyer1 (purchasing group 001, like test PO 4500000901) resolves
// BUYER-type exceptions; manager1 reads all exceptions, approves, rejects, unblocks,
// cancels and resolves suspected duplicates.
const CLERK = as('clerk1'), MANAGER = as('manager1'), BUYER = as('buyer1')
const draftOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=false)`
const activeOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=true)`
const [Exceptions, ApprovalHistory, MatchResults] = ['ap.Exceptions', 'ap.ApprovalHistory', 'ap.MatchResults']

let referenceCounter = 0

/** Saves a valid invoice for test PO 4500000901 as `user`; items: [[poItem, quantity, price]]. */
async function submit(items, user = CLERK) {
  const net = items.reduce((s, [, q, p]) => s.plus(Ratio.of(q).times(p)), Ratio.of(0)).toFixed(2)
  const { data: draft } = await POST(`${BASE}/Invoices`, {}, user)
  await PATCH(draftOf(draft.ID), {
    supplierID: '1000020', purchaseOrder: '4500000901', companyCode: '1010', currency_code: 'INR',
    supplierReference: `S-${++referenceCounter}`, invoiceDate: '2026-10-15', netAmount: net, taxAmount: 0, grossAmount: net
  }, user)
  for (const [poItem, quantity, price] of items)
    await POST(`${draftOf(draft.ID)}/items`, {
      purchaseOrderItem: poItem, quantity, unit: 'EA', unitPrice: price, netAmount: Ratio.of(quantity).times(price).toFixed(2)
    }, user)
  await POST(`${draftOf(draft.ID)}/InvoiceService.draftActivate`, {}, user)
  return draft.ID
}

// Ready-made invoices in a given status (all created by clerk1).
const CLEAN = [['00010', 10, 1000]] // -> MATCHED
const OVER_LIMIT = [['00020', 10, 25000]] // -> PENDING_APPROVAL (2,50,000 > 1,00,000)
const PRICE_AND_QTY = [['00010', 110, 1030]] // -> EXCEPTION with PRICE_VARIANCE and QTY_VARIANCE
const PRICE = [['00010', 10, 1030]] // -> EXCEPTION with one PRICE_VARIANCE
const NO_GR = [['00050', 5, 500]] // -> EXCEPTION with NO_GR

const act = (id, action, body = {}, user = CLERK) => POST(`${activeOf(id)}/InvoiceService.${action}`, body, user).then(r => r.data)
const matched = async items => { const id = await submit(items); await act(id, 'match'); return id }

/** Calls and expects a rejection; returns { status, code }. */
const rejected = promise => promise.then(
  () => { throw new Error('expected a rejection') },
  e => ({ status: e.response?.status, code: e.response?.data?.error?.code }))

const invoice = async id => (await GET(`${activeOf(id)}?$expand=items,history($orderby=at),exceptions`, CLERK)).data
const exceptionsOf = async id => (await GET(`${EXC}/Exceptions?$filter=invoice_ID eq ${id}&$orderby=type`, MANAGER)).data.value
const resolve = (exceptionID, resolution, note = 'checked with the buyer', user = BUYER) =>
  POST(`${EXC}/Exceptions(${exceptionID})/ExceptionService.resolve`, { resolution, note }, user).then(r => r.data)
const historyOf = id => SELECT.from(ApprovalHistory).where({ invoice_ID: id }).orderBy('at')

beforeEach(data.reset)

describe('S - status transitions', () => {
  test('S1 release on an EXCEPTION invoice: 409 INVALID_STATUS_TRANSITION, nothing changes', async () => {
    const id = await matched(PRICE)
    expect(await rejected(act(id, 'release'))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
    expect((await invoice(id)).status).toBe('EXCEPTION')
  })

  test('S2 cancel on a RELEASED invoice: 409 (RELEASED is final)', async () => {
    const id = await matched(CLEAN)
    await act(id, 'release')
    expect(await rejected(act(id, 'cancel', { reason: 'too late' }, MANAGER))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
    expect(await rejected(act(id, 'block', { reason: 'too late' }))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
  })

  test('S3 editing an invoice in EXCEPTION: 409, no draft is created', async () => {
    const id = await matched(PRICE)
    expect(await rejected(POST(`${activeOf(id)}/InvoiceService.draftEdit`, { PreserveChanges: true }, CLERK)))
      .toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
    expect(await rejected(GET(draftOf(id), CLERK))).toMatchObject({ status: 404 })
  })

  test('S4 last exception resolved with ACCEPT: PENDING_APPROVAL (ACCEPTED_VARIANCE)', async () => {
    const id = await matched(PRICE)
    const [exception] = await exceptionsOf(id)
    const resolved = await resolve(exception.ID, 'ACCEPT', 'price increase agreed by phone')
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolution: 'ACCEPT', resolutionNote: 'price increase agreed by phone', resolvedBy: 'buyer1' })
    expect(resolved.resolvedAt).toBeTruthy()
    expect(await invoice(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'ACCEPTED_VARIANCE' })
  })

  test('S5 all exceptions resolved with REMATCH: VALIDATED, nothing re-matched yet, match possible again', async () => {
    const id = await matched(PRICE_AND_QTY)
    for (const e of await exceptionsOf(id)) await resolve(e.ID, 'REMATCH', 'PO corrected in S/4')
    const after = await invoice(id)
    expect(after).toMatchObject({ status: 'VALIDATED', lastMatchRunID: null, approvalReason: null })
    expect(after.items[0].matchStatus).toBe('NOT_MATCHED') // old results are not shown as current
    expect(await SELECT.from(MatchResults).where({ invoice_ID: id })).toHaveLength(1) // REMATCH did not match

    await act(id, 'match') // a fresh run against current S/4 data
    expect(await SELECT.from(MatchResults).where({ invoice_ID: id })).toHaveLength(2)
    expect((await invoice(id)).status).toBe('EXCEPTION') // the PO was not really corrected
  })

  test('S6 any exception resolved with REJECT: BLOCKED with a reason naming the exception', async () => {
    const id = await matched(PRICE)
    const [exception] = await exceptionsOf(id)
    await resolve(exception.ID, 'REJECT', 'supplier overcharged')
    expect(await invoice(id)).toMatchObject({ status: 'BLOCKED', blockReason: 'Exception PRICE_VARIANCE rejected: supplier overcharged' })
  })
})

describe('exception resolution rules', () => {
  test('the invoice is recomputed only after its last open exception; REJECT wins over ACCEPT', async () => {
    const id = await matched(PRICE_AND_QTY)
    const [price, quantity] = await exceptionsOf(id)
    await resolve(price.ID, 'ACCEPT')
    expect((await invoice(id)).status).toBe('EXCEPTION') // QTY_VARIANCE is still open
    await resolve(quantity.ID, 'REJECT', 'more delivered than ordered')
    expect(await invoice(id)).toMatchObject({ status: 'BLOCKED', blockReason: 'Exception QTY_VARIANCE rejected: more delivered than ordered' })
  })

  test('ACCEPT wins over REMATCH', async () => {
    const id = await matched(PRICE_AND_QTY)
    const [price, quantity] = await exceptionsOf(id)
    await resolve(price.ID, 'REMATCH')
    await resolve(quantity.ID, 'ACCEPT')
    expect(await invoice(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalReason: 'ACCEPTED_VARIANCE' })
  })

  test('resolutions that do not fit the exception type are rejected', async () => {
    const [noGR] = await exceptionsOf(await matched(NO_GR))
    expect(await rejected(resolve(noGR.ID, 'ACCEPT'))).toEqual({ status: 400, code: 'RESOLUTION_NOT_ALLOWED' })
    expect(await rejected(resolve(noGR.ID, 'MAYBE'))).toEqual({ status: 400, code: 'INVALID_RESOLUTION' })
  })

  test('DUPLICATE_SUSPECT allows ACCEPT ("not a duplicate") and REJECT, but not REMATCH', async () => {
    await matched([['00010', 5, 1000]])
    // same supplier, date and gross amount, other reference -> suspect duplicate
    const id = await matched([['00010', 5, 1000]])
    const [suspect] = await exceptionsOf(id)
    expect(suspect.type).toBe('DUPLICATE_SUSPECT')
    expect(await rejected(resolve(suspect.ID, 'REMATCH', 'x', MANAGER))).toEqual({ status: 400, code: 'RESOLUTION_NOT_ALLOWED' })
    await resolve(suspect.ID, 'ACCEPT', 'separate delivery, not a duplicate', MANAGER) // AP Manager decides duplicates
    expect((await invoice(id)).status).toBe('PENDING_APPROVAL')
  })

  test('the note is mandatory', async () => {
    const [exception] = await exceptionsOf(await matched(PRICE))
    expect(await rejected(resolve(exception.ID, 'ACCEPT', '   '))).toEqual({ status: 400, code: 'NOTE_REQUIRED' })
  })

  test('a resolved exception cannot be resolved again', async () => {
    const id = await matched(PRICE_AND_QTY)
    const [price] = await exceptionsOf(id)
    await resolve(price.ID, 'ACCEPT')
    expect(await rejected(resolve(price.ID, 'REJECT'))).toEqual({ status: 409, code: 'EXCEPTION_NOT_OPEN' })
  })

  test('exceptions of a blocked invoice cannot be resolved; unblocking supersedes them', async () => {
    const id = await matched(PRICE)
    await act(id, 'block', { reason: 'supplier dispute' })
    const [exception] = await exceptionsOf(id)
    expect(await rejected(resolve(exception.ID, 'ACCEPT'))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })

    await act(id, 'unblock', { comment: 'dispute settled' }, as('manager1'))
    expect((await exceptionsOf(id))[0]).toMatchObject({ status: 'SUPERSEDED', resolution: null })
    expect(await rejected(resolve(exception.ID, 'ACCEPT'))).toEqual({ status: 409, code: 'EXCEPTION_NOT_OPEN' })
  })

  test('only the current match run decides: an old REJECT does not block the next round', async () => {
    const id = await matched(PRICE)
    const [first] = await exceptionsOf(id)
    await resolve(first.ID, 'REJECT', 'wrong price') // -> BLOCKED
    await act(id, 'unblock', { comment: 'supplier sent the agreed price list' }, MANAGER)
    await act(id, 'match') // new run, new PRICE_VARIANCE
    const second = (await exceptionsOf(id)).find(e => e.status === 'OPEN')
    await resolve(second.ID, 'ACCEPT', 'price list confirms it')
    expect((await invoice(id)).status).toBe('PENDING_APPROVAL')
  })
})

describe('invoice actions', () => {
  test('release: MATCHED -> RELEASED; R1 a second release is 409 and writes no second history row', async () => {
    const id = await matched(CLEAN)
    expect(await act(id, 'release')).toMatchObject({ status: 'RELEASED' })
    expect(await rejected(act(id, 'release'))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
    expect((await historyOf(id)).filter(h => h.action === 'RELEASE')).toHaveLength(1)
  })

  test('approve: only from PENDING_APPROVAL, by someone other than the creator, comment recorded', async () => {
    const clean = await matched(CLEAN)
    expect(await rejected(act(clean, 'approve', {}, MANAGER))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })

    const id = await matched(OVER_LIMIT)
    expect(await rejected(act(id, 'approve', {}, CLERK))).toEqual({ status: 403, code: '403' }) // not an AP Manager
    expect(await act(id, 'approve', { comment: 'budget confirmed' }, MANAGER)).toMatchObject({ status: 'RELEASED', approvalReason: null })
    expect((await historyOf(id)).at(-1)).toMatchObject({
      action: 'APPROVE', fromStatus: 'PENDING_APPROVAL', toStatus: 'RELEASED', actor: 'manager1', actorRole: 'APManager', comment: 'budget confirmed'
    })
  })

  test('approve: an AP Manager cannot approve an invoice they created (SoD)', async () => {
    // AP Managers cannot create invoices (phase 6), so this one is a test/data fixture created by manager1.
    const id = '11111111-0000-4000-8000-000000000003'
    expect(await rejected(act(id, 'approve', {}, MANAGER))).toEqual({ status: 403, code: 'SOD_SELF_APPROVAL' })
    expect((await invoice(id)).status).toBe('PENDING_APPROVAL')
  })

  test('reject: PENDING_APPROVAL -> BLOCKED; the reason is required and becomes the block reason', async () => {
    const id = await matched(OVER_LIMIT)
    expect(await rejected(act(id, 'reject', {}, MANAGER))).toEqual({ status: 400, code: 'REASON_REQUIRED' })
    expect(await act(id, 'reject', { reason: 'no budget' }, MANAGER)).toMatchObject({ status: 'BLOCKED', blockReason: 'no budget', approvalReason: null })
  })

  test('block: from VALIDATED, MATCHED, EXCEPTION and PENDING_APPROVAL; reason required', async () => {
    for (const make of [() => submit(CLEAN), () => matched(CLEAN), () => matched(PRICE), () => matched(OVER_LIMIT)]) {
      const id = await make()
      const from = (await invoice(id)).status
      expect(await rejected(act(id, 'block', { reason: '' }))).toEqual({ status: 400, code: 'REASON_REQUIRED' })
      expect(await act(id, 'block', { reason: `stop (${from})` })).toMatchObject({ status: 'BLOCKED', blockReason: `stop (${from})` })
    }
  })

  test('unblock: BLOCKED -> VALIDATED with a required comment; a fresh match is needed', async () => {
    const id = await matched(CLEAN)
    await act(id, 'block', { reason: 'supplier dispute' })
    expect(await rejected(act(id, 'unblock', {}, MANAGER))).toEqual({ status: 400, code: 'COMMENT_REQUIRED' })
    const unblocked = await act(id, 'unblock', { comment: 'dispute settled' }, MANAGER)
    expect(unblocked).toMatchObject({ status: 'VALIDATED', blockReason: null, lastMatchRunID: null })
    await act(id, 'match')
    expect(await SELECT.from(MatchResults).where({ invoice_ID: id })).toHaveLength(2) // old run kept for audit
  })

  test('cancel: BLOCKED -> CANCELLED (final); reason required; the reference can be resubmitted', async () => {
    const id = await matched(CLEAN)
    const { supplierReference } = await invoice(id)
    await act(id, 'block', { reason: 'wrong amounts' })
    expect(await rejected(act(id, 'cancel', { reason: ' ' }, MANAGER))).toEqual({ status: 400, code: 'REASON_REQUIRED' })
    expect(await act(id, 'cancel', { reason: 'supplier sends a corrected invoice' }, MANAGER)).toMatchObject({ status: 'CANCELLED' })

    expect(await rejected(act(id, 'unblock', { comment: 'reopen' }, MANAGER))).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
    expect(await rejected(POST(`${activeOf(id)}/InvoiceService.draftEdit`, { PreserveChanges: true }, CLERK)))
      .toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' })

    // D1/D4: the same supplier reference is accepted again
    const { data: draft } = await POST(`${BASE}/Invoices`, {}, CLERK)
    await PATCH(draftOf(draft.ID), {
      supplierID: '1000020', purchaseOrder: '4500000901', supplierReference, invoiceDate: '2026-10-16',
      netAmount: 1000, taxAmount: 0, grossAmount: 1000
    }, CLERK)
    await POST(`${draftOf(draft.ID)}/items`, { purchaseOrderItem: '00010', quantity: 1, unit: 'EA', unitPrice: 1000, netAmount: 1000 }, CLERK)
    await expect(POST(`${draftOf(draft.ID)}/InvoiceService.draftActivate`, {}, CLERK)).resolves.toBeTruthy()
  })

  test('submitted invoices cannot be deleted or patched directly; actions on drafts are refused', async () => {
    const id = await submit(CLEAN)
    expect(await rejected(axios.delete(activeOf(id), CLERK))).toEqual({ status: 409, code: 'ACTIVE_INVOICE_NOT_DELETABLE' })
    const patch = await rejected(PATCH(activeOf(id), { taxAmount: 1 }, CLERK))
    expect(patch.status).toBeGreaterThanOrEqual(400)
    expect((await invoice(id)).status).toBe('VALIDATED')

    const { data: draft } = await POST(`${BASE}/Invoices`, {}, CLERK)
    expect(await rejected(POST(`${draftOf(draft.ID)}/InvoiceService.release`, {}, CLERK))).toEqual({ status: 409, code: 'SAVED_INVOICE_REQUIRED' })
  })
})

describe('H - audit', () => {
  test('H1 every status change writes exactly one history row with actor, role, from and to', async () => {
    const id = await matched(PRICE)
    const [exception] = await exceptionsOf(id)
    await resolve(exception.ID, 'ACCEPT', 'agreed', as('buyer1'))
    await act(id, 'approve', { comment: 'ok' }, MANAGER)

    expect((await historyOf(id)).map(h => [h.action, h.fromStatus, h.toStatus, h.actor, h.actorRole])).toEqual([
      ['SUBMIT', null, 'VALIDATED', 'clerk1', 'APClerk'],
      ['MATCH', 'VALIDATED', 'EXCEPTION', 'clerk1', 'APClerk'],
      ['RESOLVE', 'EXCEPTION', 'PENDING_APPROVAL', 'buyer1', 'Buyer'],
      ['APPROVE', 'PENDING_APPROVAL', 'RELEASED', 'manager1', 'APManager']
    ])
    const resolveRow = (await historyOf(id))[2]
    expect(resolveRow).toMatchObject({ exception_ID: exception.ID, comment: 'ACCEPT PRICE_VARIANCE: agreed' })
    expect(resolveRow.at).toBeTruthy()
  })

  test('H1 the change-tracking plugin records the field changes with the user', async () => {
    const id = await matched(CLEAN)
    await act(id, 'release')
    const changes = await SELECT.from('sap.changelog.Changes')
      .columns('attribute', 'valueChangedFrom', 'valueChangedTo', 'modification', 'createdBy')
      .where({ entity: 'ap.Invoices', entityKey: id, attribute: 'status' })
    expect(changes).toEqual(expect.arrayContaining([
      { attribute: 'status', valueChangedFrom: null, valueChangedTo: 'VALIDATED', modification: 'create', createdBy: 'clerk1' },
      { attribute: 'status', valueChangedFrom: 'VALIDATED', valueChangedTo: 'MATCHED', modification: 'update', createdBy: 'clerk1' },
      { attribute: 'status', valueChangedFrom: 'MATCHED', valueChangedTo: 'RELEASED', modification: 'update', createdBy: 'clerk1' }
    ]))
    const [exception] = await exceptionsOf(await matched(PRICE))
    await resolve(exception.ID, 'REJECT', 'wrong')
    expect(await SELECT.from('sap.changelog.Changes').columns('attribute', 'valueChangedTo')
      .where({ entity: 'ap.Exceptions', entityKey: exception.ID, modification: 'update' }))
      .toEqual(expect.arrayContaining([{ attribute: 'status', valueChangedTo: 'RESOLVED' }, { attribute: 'resolution', valueChangedTo: 'REJECT' }]))
  })

  test('history cannot be created, changed or deleted through any service', async () => {
    const id = await submit(CLEAN)
    const [row] = await historyOf(id)
    for (const [service, user] of [[BASE, CLERK], [EXC, MANAGER]]) {
      expect((await rejected(POST(`${service}/ApprovalHistory`, { action: 'RELEASE' }, user))).status).toBe(405)
      expect((await rejected(PATCH(`${service}/ApprovalHistory(${row.ID})`, { comment: 'x' }, user))).status).toBe(405)
      expect((await rejected(axios.delete(`${service}/ApprovalHistory(${row.ID})`, user))).status).toBe(405)
    }
  })
})

describe('transactions', () => {
  // Makes the next ApprovalHistory insert fail, as a database error would.
  let failHistory = false
  beforeAll(() => cds.db.prepend(() => cds.db.before('CREATE', ApprovalHistory, () => {
    if (failHistory) throw new Error('simulated database failure')
  })))
  afterEach(() => { failHistory = false })

  test('an action whose history row cannot be written changes nothing', async () => {
    const id = await matched(CLEAN)
    failHistory = true
    expect((await rejected(act(id, 'release'))).status).toBe(500)
    failHistory = false
    expect((await invoice(id)).status).toBe('MATCHED')
    expect((await historyOf(id)).map(h => h.action)).toEqual(['SUBMIT', 'MATCH'])
  })

  test('a failed resolution leaves the exception open and the invoice unchanged', async () => {
    const id = await matched(PRICE)
    const [exception] = await exceptionsOf(id)
    failHistory = true
    expect((await rejected(resolve(exception.ID, 'ACCEPT'))).status).toBe(500)
    failHistory = false
    expect(await SELECT.one.from(Exceptions, exception.ID).columns('status', 'resolution')).toEqual({ status: 'OPEN', resolution: null })
    expect((await invoice(id)).status).toBe('EXCEPTION')
  })
})

describe('R3 - ETags', () => {
  test('an action with a stale ETag gets 412 and changes nothing', async () => {
    const id = await matched(CLEAN)
    const { data: seen } = await GET(activeOf(id), CLERK)
    await act(id, 'block', { reason: 'someone else blocked it' }, MANAGER) // changes modifiedAt
    const stale = { ...MANAGER, headers: { 'If-Match': seen['@odata.etag'] } }
    expect((await rejected(POST(`${activeOf(id)}/InvoiceService.unblock`, { comment: 'x' }, stale))).status).toBe(412)
    expect((await invoice(id)).status).toBe('BLOCKED')

    const { data: current } = await GET(activeOf(id), CLERK)
    const fresh = { ...MANAGER, headers: { 'If-Match': current['@odata.etag'] } }
    await expect(POST(`${activeOf(id)}/InvoiceService.unblock`, { comment: 'settled' }, fresh)).resolves.toBeTruthy()
  })

  test('resolving an exception with a stale ETag gets 412', async () => {
    const id = await matched(PRICE_AND_QTY)
    const [price, quantity] = await exceptionsOf(id)
    await act(id, 'block', { reason: 'hold' }) // the exception rows are unchanged, the invoice changed
    await act(id, 'unblock', { comment: 'go on' }, MANAGER) // supersedes the exceptions (modifiedAt changes)
    const stale = { ...BUYER, headers: { 'If-Match': price['@odata.etag'] } }
    expect((await rejected(POST(`${EXC}/Exceptions(${quantity.ID})/ExceptionService.resolve`, { resolution: 'ACCEPT', note: 'x' }, stale))).status).toBe(412)
  })

  test('a write without If-Match is refused with 428 (Fiori always sends it)', async () => {
    const id = await matched(CLEAN)
    delete axios.defaults.headers['If-Match']
    try {
      expect((await rejected(POST(`${activeOf(id)}/InvoiceService.release`, {}, CLERK))).status).toBe(428)
    } finally {
      axios.defaults.headers['If-Match'] = '*'
    }
    expect((await invoice(id)).status).toBe('MATCHED')
  })
})
