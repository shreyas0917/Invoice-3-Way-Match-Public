// Phase 4: tolerance rules in AdminService - draft editing, declarative checks and the
// "one active rule per company code, variance type and date" overlap rule.
// Existing rules: global PRICE + QUANTITY from 2026-01-01 (db/data); test/data adds
// 1020 PRICE from 2026-01-01, 1010 PRICE 2025 only, 1010 QUANTITY inactive.
const cds = require('@sap/cds')
const path = require('path')

const { POST, PATCH, data } = cds.test(path.join(__dirname, '../..'))

const BASE = '/odata/v4/admin'
const AS_MANAGER = { auth: { username: 'manager1', password: '' } }

const RULE = {
  companyCode: '1010', varianceType: 'PRICE', upperPercent: 3, lowerPercent: 3,
  upperAbsolute: 1000, lowerAbsolute: 1000, currency_code: 'INR', validFrom: '2026-01-01', isActive: true
}

/** Creates a rule draft and saves it; resolves with the saved rule. */
async function saveRule(rule) {
  const { data: draft } = await POST(`${BASE}/ToleranceRules`, {}, AS_MANAGER)
  const draftUrl = `${BASE}/ToleranceRules(ID=${draft.ID},IsActiveEntity=false)`
  await PATCH(draftUrl, rule, AS_MANAGER)
  return (await POST(`${draftUrl}/AdminService.draftActivate`, {}, AS_MANAGER)).data
}

async function saveRejected(rule) {
  const response = await saveRule(rule).then(() => { throw new Error('expected rejection') }, e => e.response)
  const error = response.data.error
  return { status: response.status, codes: (error.details ?? [error]).map(e => e.code) }
}

beforeEach(data.reset)

describe('AdminService tolerance rules', () => {
  test('a company rule for a period without another active rule can be saved', async () => {
    // 1010 PRICE: the only other rule ends 2025-12-31, so a rule from 2026-01-01 does not overlap
    await expect(saveRule(RULE)).resolves.toMatchObject({ IsActiveEntity: true, companyCode: '1010', validTo: null })
  })

  test('an overlapping active rule for the same company code and type is rejected with 409', async () => {
    expect(await saveRejected({ ...RULE, validFrom: '2025-12-31' })).toEqual({ status: 409, codes: ['TOLERANCE_RULE_OVERLAP'] })
  })

  test('a second global rule overlapping the global default is rejected; empty company code means global', async () => {
    expect(await saveRejected({ ...RULE, companyCode: '', validFrom: '2026-06-01', validTo: '2026-06-30' }))
      .toEqual({ status: 409, codes: ['TOLERANCE_RULE_OVERLAP'] })
  })

  test('an overlap is allowed when either rule is inactive, or for another variance type or company', async () => {
    await expect(saveRule({ ...RULE, validFrom: '2025-06-01', isActive: false })).resolves.toBeTruthy()
    await expect(saveRule({ ...RULE, varianceType: 'QUANTITY' })).resolves.toBeTruthy() // the 1010 QUANTITY rule is inactive
    await expect(saveRule({ ...RULE, companyCode: '1030' })).resolves.toBeTruthy()
  })

  test('declarative checks: validTo before validFrom, percent above 100, negative absolute, unknown type', async () => {
    expect((await saveRejected({ ...RULE, validFrom: '2026-02-01', validTo: '2026-01-31' })).codes).toEqual(['TOLERANCE_VALID_TO_BEFORE_FROM'])
    expect((await saveRejected({ ...RULE, companyCode: '1030', upperPercent: 101 })).codes).toEqual(['ASSERT_RANGE'])
    expect((await saveRejected({ ...RULE, companyCode: '1030', lowerAbsolute: -1 })).codes).toEqual(['ASSERT_RANGE'])
    expect((await saveRejected({ ...RULE, companyCode: '1030', varianceType: 'FREIGHT' })).codes).toEqual(['ASSERT_ENUM'])
  })
})
