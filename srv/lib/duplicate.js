/**
 * Duplicate-invoice rules (blueprint workflow 7) as pure functions.
 *
 * D1 exact duplicate: same supplier + same normalised reference + same fiscal year as
 *    another non-cancelled invoice -> the save is blocked (409 DUPLICATE_INVOICE).
 * D2 normalisation: upper-case; remove spaces, '-', '/', '.'; strip leading zeros from
 *    numeric runs. So 'inv-0045', 'INV 45', 'INV/45' and 'INV.0045' all become 'INV45'.
 * D3 (suspect duplicate during matching) belongs to phase 4 and is not implemented here.
 */

/** D2: the comparison key for a supplier reference ('' for empty input). */
function normalizeReference(reference) {
  return String(reference ?? '')
    .toUpperCase()
    .replace(/[\s\-/.]/g, '')
    .replace(/\d+/g, digits => digits.replace(/^0+(?=\d)/, '')) // '0045' -> '45', '000' -> '0'
}

/** Fiscal year of an invoice date: the calendar year in the MVP ('2026-10-15' -> '2026'). */
function fiscalYearOf(invoiceDate) {
  if (!invoiceDate) return null
  const year = String(invoiceDate).slice(0, 4)
  return /^\d{4}$/.test(year) ? year : null
}

/** Statuses that do not block a resubmission with the same reference (D4). */
const NON_BLOCKING_STATUSES = ['CANCELLED']

module.exports = { normalizeReference, fiscalYearOf, NON_BLOCKING_STATUSES }
