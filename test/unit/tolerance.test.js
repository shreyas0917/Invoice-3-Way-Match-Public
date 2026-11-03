// Unit tests for srv/lib/tolerance.js: rule selection and the price/quantity checks.
const { selectRule, checkPrice, checkQuantity, ZERO_TOLERANCE } = require('../../srv/lib/tolerance')
const { Ratio } = require('../../srv/lib/decimal')

const rule = (over = {}) => ({
  ID: 'global-price', companyCode: null, varianceType: 'PRICE', upperPercent: '2.00', lowerPercent: '5.00',
  upperAbsolute: '500.00', lowerAbsolute: '500.00', currency_code: 'INR', validFrom: '2026-01-01', validTo: null,
  isActive: true, ...over
})
const on = (over = {}) => ({ companyCode: '1010', varianceType: 'PRICE', onDate: '2026-10-15', currency: 'INR', ...over })

describe('selectRule', () => {
  test('a valid company rule wins over the global rule', () => {
    const rules = [rule(), rule({ ID: 'company', companyCode: '1010' })]
    expect(selectRule(rules, on()).rule.ID).toBe('company')
  })

  test("another company's rule is never used; the global rule applies", () => {
    const rules = [rule(), rule({ ID: 'other', companyCode: '1020' })]
    expect(selectRule(rules, on()).rule.ID).toBe('global-price')
  })

  test('validFrom and validTo are inclusive', () => {
    const company = rule({ ID: 'company', companyCode: '1010', validFrom: '2026-10-15', validTo: '2026-10-15' })
    expect(selectRule([rule(), company], on()).rule.ID).toBe('company')
    expect(selectRule([rule(), company], on({ onDate: '2026-10-16' })).rule.ID).toBe('global-price')
    expect(selectRule([rule(), company], on({ onDate: '2026-10-14' })).rule.ID).toBe('global-price')
  })

  test('expired, inactive and other-type rules are ignored', () => {
    const rules = [
      rule({ ID: 'expired', companyCode: '1010', validTo: '2025-12-31', validFrom: '2025-01-01' }),
      rule({ ID: 'inactive', companyCode: '1010', isActive: false }),
      rule({ ID: 'quantity', companyCode: '1010', varianceType: 'QUANTITY' }),
      rule()
    ]
    expect(selectRule(rules, on()).rule.ID).toBe('global-price')
  })

  test('the global rule is not applied before its validFrom', () => {
    expect(selectRule([rule()], on({ onDate: '2025-12-31' }))).toMatchObject({
      rule: null, limits: ZERO_TOLERANCE, warnings: [{ code: 'NO_TOLERANCE_RULE', args: ['PRICE', '1010', '2025-12-31'] }]
    })
  })

  test('no rule at all: zero tolerance with a warning', () => {
    expect(selectRule([], on())).toEqual({
      rule: null, limits: ZERO_TOLERANCE, warnings: [{ code: 'NO_TOLERANCE_RULE', args: ['PRICE', '1010', '2026-10-15'] }]
    })
  })

  test('a rule in another currency is not applied: zero tolerance with a warning', () => {
    expect(selectRule([rule()], on({ currency: 'EUR' }))).toEqual({
      rule: null, limits: ZERO_TOLERANCE, warnings: [{ code: 'TOLERANCE_RULE_CURRENCY_MISMATCH', args: ['PRICE', 'INR', 'EUR'] }]
    })
  })

  test('should two rules overlap, the newer one is used', () => {
    const rules = [rule({ ID: 'old' }), rule({ ID: 'new', validFrom: '2026-06-01' })]
    expect(selectRule(rules, on()).rule.ID).toBe('new')
  })
})

describe('checkPrice', () => {
  const limits = rule()
  const price = (invoicedUnitPrice, invoicedQuantity, poUnitPrice = Ratio.of(1000)) =>
    checkPrice({ invoicedUnitPrice, poUnitPrice, invoicedQuantity, limits })

  test('equal price passes with 0 %', () => {
    expect(price(1000, 10)).toMatchObject({ passes: true })
    expect(price(1000, 10).pct.toFixed(2)).toBe('0.00')
  })

  test('above PO: both limits inclusive, both must hold', () => {
    expect(price('1020.00', 25).passes).toBe(true) // 2.00 % and 500.00
    expect(price('1020.01', 1).passes).toBe(false) // 2.001 %
    expect(price('1020.00', 26).passes).toBe(false) // 2 % but 520
    expect(price('1010.00', 60).passes).toBe(false) // 1 % but 600
  })

  test('below PO uses the lower limits', () => {
    expect(price('950.00', 10).passes).toBe(true) // -5 %, -500
    expect(price('949.99', 1).passes).toBe(false) // beyond -5 %
    expect(price('990.00', 51).passes).toBe(false) // -1 % but -510
  })

  test('percent is exact for non-terminating PO prices (1000 / 3)', () => {
    const third = Ratio.of(1000).dividedBy(3)
    const result = price('340.00', 1, third) // +2.000 %
    expect(result.pct.toFixed(4)).toBe('2.0000')
    expect(result.passes).toBe(true)
  })

  test('a price on a free PO item is always a variance', () => {
    expect(price('1.00', 1, Ratio.of(0))).toMatchObject({ passes: false, pct: null })
  })

  test('zero tolerance fails on one paisa', () => {
    expect(checkPrice({ invoicedUnitPrice: '1000.01', poUnitPrice: Ratio.of(1000), invoicedQuantity: 1, limits: ZERO_TOLERANCE }).passes).toBe(false)
  })
})

describe('checkQuantity', () => {
  const limits = { upperPercent: '10.00', upperAbsolute: '1000.00' }
  const quantity = (invoicedQuantity, openQuantity, l = limits) =>
    checkQuantity({ invoicedQuantity, openQuantity, poUnitPrice: Ratio.of(100), limits: l })

  test('partial and exact invoices pass', () => {
    expect(quantity(40, 100)).toMatchObject({ passes: true })
    expect(quantity(40, 100).excess.toFixed(3)).toBe('-60.000')
    expect(quantity(100, 100).passes).toBe(true)
  })

  test('over-invoicing passes only within both limits (inclusive)', () => {
    expect(quantity(110, 100).passes).toBe(true) // 10 %, 1,000
    expect(quantity('110.001', 100).passes).toBe(false) // just over 10 %
    expect(quantity(11, 10, { upperPercent: '10.00', upperAbsolute: '99.99' }).passes).toBe(false) // 10 % but 100.00
  })

  test('nothing open: any invoiced quantity is a variance', () => {
    expect(quantity(1, 0)).toMatchObject({ passes: false })
    expect(quantity(1, -5).passes).toBe(false)
  })

  test('zero tolerance fails on any excess', () => {
    expect(quantity('100.001', 100, ZERO_TOLERANCE).passes).toBe(false)
  })
})
