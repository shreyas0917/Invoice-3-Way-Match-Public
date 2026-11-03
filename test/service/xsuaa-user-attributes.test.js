// Phase 11: purchasing-group restrictions with user attributes shaped like XSUAA delivers them
// (xs.user.attributes: arrays of strings). The phase 6 tests use single strings (mocked users);
// on BTP a Buyer role carries purchasingGroup as ["001"], possibly several groups, and a
// misconfigured role none at all - which must show nothing, never everything.
const cds = require('@sap/cds')
const path = require('path')
const { Ratio } = require('../../srv/lib/decimal')

// Test-only users, added before the server starts (not part of package.json).
Object.assign(cds.env.requires.auth.users, {
  'xs-buyer-001': { roles: ['Buyer'], attr: { purchasingGroup: ['001'] } },
  'xs-buyer-both': { roles: ['Buyer'], attr: { purchasingGroup: ['001', '002'] } },
  'xs-buyer-empty': { roles: ['Buyer'], attr: { purchasingGroup: [] } },
  'xs-buyer-none': { roles: ['Buyer'], attr: {} }
})

const { GET, POST, PATCH, axios } = cds.test(path.join(__dirname, '../..'))
axios.defaults.headers['If-Match'] = '*'

const INV = '/odata/v4/invoice', EXC = '/odata/v4/exception'
const as = user => ({ auth: { username: user, password: '' } })
const CLERK = as('clerk1')

/** A matched invoice with a BUYER price exception for the PO's purchasing group. */
async function priceException(header, reference, price) {
  const { data: { ID } } = await POST(`${INV}/Invoices`, {}, CLERK)
  const draft = `${INV}/Invoices(ID=${ID},IsActiveEntity=false)`
  const net = Ratio.of(10).times(price).toFixed(2)
  await PATCH(draft, { ...header, currency_code: 'INR', supplierReference: reference, invoiceDate: '2026-10-15', netAmount: net, taxAmount: 0, grossAmount: net }, CLERK)
  await POST(`${draft}/items`, { purchaseOrderItem: '00010', quantity: 10, unit: 'EA', unitPrice: price, netAmount: net }, CLERK)
  await POST(`${draft}/InvoiceService.draftActivate`, {}, CLERK)
  await POST(`${INV}/Invoices(ID=${ID},IsActiveEntity=true)/InvoiceService.match`, {}, CLERK)
  return ID
}

let invoice001, invoice002
beforeAll(async () => {
  invoice001 = await priceException({ supplierID: '1000020', purchaseOrder: '4500000901', companyCode: '1010' }, 'XS-001', 1030) // group 001: +3 % > 2 % global rule
  invoice002 = await priceException({ supplierID: '1000030', purchaseOrder: '4500000902', companyCode: '1020' }, 'XS-002', 1150) // group 002: +15 % > 10 % company 1020 rule
})

const groupsSeenBy = async user => {
  const { data: { value } } = await GET(`${EXC}/Exceptions?$select=purchasingGroup,invoice_ID`, as(user))
  return [...new Set(value.map(e => e.purchasingGroup))].sort()
}

test('the fixtures produced one BUYER exception per purchasing group', async () => {
  expect(await groupsSeenBy('manager1')).toEqual(expect.arrayContaining(['001', '002']))
})

test('["001"] sees only group 001 - like the string "001"', async () => {
  expect(await groupsSeenBy('xs-buyer-001')).toEqual(['001'])
  expect(await groupsSeenBy('buyer1')).toEqual(['001'])
})

test('a role with two groups sees both', async () => {
  expect(await groupsSeenBy('xs-buyer-both')).toEqual(['001', '002'])
})

test('a Buyer role without a purchasing group sees nothing (fails closed)', async () => {
  expect(await groupsSeenBy('xs-buyer-empty')).toEqual([])
  expect(await groupsSeenBy('xs-buyer-none')).toEqual([])
})

test('invoice and resolve access follow the same groups', async () => {
  const status = p => p.then(r => r.status, e => e.response?.status)
  expect(await status(GET(`${EXC}/Invoices(${invoice001})`, as('xs-buyer-001')))).toBe(200)
  expect(await status(GET(`${EXC}/Invoices(${invoice002})`, as('xs-buyer-001')))).toBe(404)
  expect(await status(GET(`${EXC}/Invoices(${invoice002})`, as('xs-buyer-none')))).toBe(404)
  const { data: { value: [other] } } = await GET(`${EXC}/Exceptions?$filter=invoice_ID eq ${invoice002}`, as('manager1'))
  expect(await status(POST(`${EXC}/Exceptions(${other.ID})/ExceptionService.resolve`, { resolution: 'ACCEPT', note: 'x' }, as('xs-buyer-001'))))
    .toBeGreaterThanOrEqual(403)
})
