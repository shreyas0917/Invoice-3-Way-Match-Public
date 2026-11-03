/**
 * AdminService handlers: one active tolerance rule per company code and variance type
 * for any date. @assert.unique cannot express overlapping date ranges, so it is checked
 * here when a rule draft is saved.
 */
const cds = require('@sap/cds')

/** Shown on every tolerance rule; matches srv/lib/tolerance.js. */
const HOW_RULES_APPLY =
  'A variance passes only when it is within both the percentage limit and the absolute amount limit. ' +
  'A rule for the invoice\'s company code overrides the global rule (empty company code). ' +
  'Valid from and valid to are inclusive; inactive or expired rules are not applied. ' +
  'Absolute limits are amounts in the rule\'s currency and are never converted: ' +
  'for an invoice in another currency the rule is not applied and zero tolerance is used.'

module.exports = class AdminService extends cds.ApplicationService {
  init() {
    const { ToleranceRules } = this.entities
    const { ToleranceRules: SavedRules } = cds.entities('ap')

    this.after('READ', [ToleranceRules, ToleranceRules.drafts], rows => {
      for (const row of Array.isArray(rows) ? rows : [rows]) if (row) row.howRulesApply = HOW_RULES_APPLY
    })

    this.before('SAVE', ToleranceRules, async req => {
      const rule = req.data
      if (rule.companyCode === '') rule.companyCode = null // '' and null both mean "global"
      if (rule.isActive === false || !rule.varianceType || !rule.validFrom) return

      // Ranges [from, to] overlap if each starts before the other ends; empty validTo = open.
      const query = SELECT.one.from(SavedRules).columns('validFrom', 'validTo')
        .where({ varianceType: rule.varianceType, isActive: true, ID: { '!=': rule.ID } })
        .and(rule.companyCode ? { companyCode: rule.companyCode } : { companyCode: null })
        .and`(validTo is null or validTo >= ${rule.validFrom})`
      if (rule.validTo) query.and`validFrom <= ${rule.validTo}`
      const overlapping = await query

      if (overlapping)
        req.reject({
          status: 409, code: 'TOLERANCE_RULE_OVERLAP', message: 'TOLERANCE_RULE_OVERLAP', target: 'in/validFrom',
          args: [rule.varianceType, rule.companyCode ?? '(global)', overlapping.validFrom, overlapping.validTo ?? 'open']
        })
    })

    return super.init()
  }
}
