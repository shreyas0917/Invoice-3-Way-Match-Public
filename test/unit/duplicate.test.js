// Unit tests for srv/lib/duplicate.js (D2 normalisation, fiscal year).
const { normalizeReference, fiscalYearOf } = require('../../srv/lib/duplicate')

describe('D2 normalizeReference', () => {
  test.each([
    ['inv-0045', 'INV45'],
    ['INV 45', 'INV45'],
    ['INV/45', 'INV45'],
    ['INV.0045', 'INV45'],
    ['  inv - 0045 ', 'INV45'],
    ['2026/INV/007-01', '2026INV701'], // separators go first (2026INV00701), then the run 00701 -> 701
    ['INV-000', 'INV0'], // an all-zero run keeps one zero
    ['A0B', 'A0B'],
    [null, '']
  ])('%p -> %p', (input, expected) => {
    expect(normalizeReference(input)).toBe(expected)
  })

  test('references that differ in substance stay different', () => {
    expect(normalizeReference('INV-45')).not.toBe(normalizeReference('INV-450'))
    expect(normalizeReference('INV-45A')).not.toBe(normalizeReference('INV-45'))
  })
})

describe('fiscalYearOf', () => {
  test('is the calendar year of the invoice date (MVP rule)', () => {
    expect(fiscalYearOf('2026-01-01')).toBe('2026')
    expect(fiscalYearOf('2025-12-31')).toBe('2025')
    expect(fiscalYearOf(null)).toBeNull()
  })
})
