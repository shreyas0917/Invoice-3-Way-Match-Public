/**
 * Tolerance rules (blueprint workflow 6) as pure functions: which rule applies, and
 * whether a price or quantity variance stays within it.
 *
 * Selection: the active rule for the invoice's company code and variance type that is
 * valid on the invoice date (validFrom and validTo inclusive); else the global rule
 * (empty company code); else zero tolerance with a warning. Both the percent and the
 * absolute limit must hold. All arithmetic is exact (Ratio), limits are inclusive.
 */
const { Ratio } = require('./decimal')

/** Limits used when no rule applies: any variance fails. */
const ZERO_TOLERANCE = Object.freeze({ upperPercent: '0', lowerPercent: '0', upperAbsolute: '0', lowerAbsolute: '0' })

/**
 * @param {object[]} rules all tolerance rules (any company, type, date, state)
 * @param {object}   on    { companyCode, varianceType, onDate: 'YYYY-MM-DD', currency }
 * @returns {{ rule: object|null, limits: object, warnings: object[] }}
 */
function selectRule(rules, { companyCode, varianceType, onDate, currency }) {
  const applicable = rules.filter(r => isApplicable(r, varianceType, onDate))
  const rule =
    latest(applicable.filter(r => !isGlobal(r) && r.companyCode === companyCode)) ??
    latest(applicable.filter(isGlobal))

  if (!rule)
    return { rule: null, limits: ZERO_TOLERANCE, warnings: [{ code: 'NO_TOLERANCE_RULE', args: [varianceType, companyCode, onDate] }] }

  // Absolute limits are amounts in the rule's currency; never compare across currencies.
  if (rule.currency_code !== currency)
    return {
      rule: null, limits: ZERO_TOLERANCE,
      warnings: [{ code: 'TOLERANCE_RULE_CURRENCY_MISMATCH', args: [varianceType, rule.currency_code, currency] }]
    }

  return { rule, limits: rule, warnings: [] }
}

function isApplicable(rule, varianceType, onDate) {
  return rule.isActive === true &&
    rule.varianceType === varianceType &&
    String(rule.validFrom) <= onDate &&
    (!rule.validTo || onDate <= String(rule.validTo))
}

const isGlobal = rule => !rule.companyCode

/** Overlaps are prevented on save; should one slip through, the newest rule wins. */
function latest(rules) {
  return rules.sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)))[0]
}

/**
 * Price check for one item.
 * pct = (invoice price − PO price) ÷ PO price × 100; amount = difference × invoiced quantity.
 * Above PO: pct ≤ upperPercent and amount ≤ upperAbsolute. Below PO: |pct| ≤ lowerPercent
 * and |amount| ≤ lowerAbsolute.
 * @returns {{ passes: boolean, pct: Ratio|null, amount: Ratio }}
 */
function checkPrice({ invoicedUnitPrice, poUnitPrice, invoicedQuantity, limits }) {
  const difference = Ratio.of(invoicedUnitPrice).minus(poUnitPrice)
  const amount = difference.times(invoicedQuantity)
  const pct = poUnitPrice.sign() === 0 ? null : difference.times(100).dividedBy(poUnitPrice)
  let passes
  if (difference.sign() === 0) passes = true
  else if (pct === null) passes = false // a price on a free PO item is always a variance
  else if (difference.sign() > 0) passes = pct.lte(limits.upperPercent) && amount.lte(limits.upperAbsolute)
  else passes = pct.abs().lte(limits.lowerPercent) && amount.abs().lte(limits.lowerAbsolute)
  return { passes, pct, amount }
}

/**
 * Quantity check for one item.
 * excess = invoiced quantity − open quantity. Passes if excess ≤ 0 (partial invoices
 * always pass), or if excess ÷ open × 100 ≤ upperPercent and excess × PO price ≤ upperAbsolute.
 * Nothing open (open ≤ 0) and something invoiced is always a variance.
 * @returns {{ passes: boolean, excess: Ratio, value: Ratio }}
 */
function checkQuantity({ invoicedQuantity, openQuantity, poUnitPrice, limits }) {
  const open = Ratio.of(openQuantity)
  const excess = Ratio.of(invoicedQuantity).minus(open)
  const value = excess.times(poUnitPrice)
  if (excess.sign() <= 0) return { passes: true, excess, value }
  if (open.sign() <= 0) return { passes: false, excess, value }
  const pct = excess.times(100).dividedBy(open)
  return { passes: pct.lte(limits.upperPercent) && value.lte(limits.upperAbsolute), excess, value }
}

module.exports = { selectRule, checkPrice, checkQuantity, ZERO_TOLERANCE }
