// Unit tests for srv/lib/value-help.js (no server, no HTTP).
const { applyQuery, equalityValue, searchText } = require('../../srv/lib/value-help')

const rows = [
  { id: '1', name: 'Acme', qty: 5, blocked: false },
  { id: '2', name: 'Bharat Office', qty: 10, blocked: true },
  { id: '3', name: 'Deccan Steel', qty: 1, blocked: false }
]
const ref = name => ({ ref: [name] })
const val = v => ({ val: v })

describe('value-help applyQuery', () => {
  test('filters with and/or and comparison operators', () => {
    const where = [ref('qty'), '>=', val(5), 'and', { xpr: [ref('blocked'), '=', val(false), 'or', ref('id'), '=', val('2')] }]
    expect(applyQuery(rows, { where }).map(r => r.id)).toEqual(['1', '2'])
  })

  test('supports functions, in-lists, not and is null', () => {
    expect(applyQuery(rows, { where: [{ func: 'contains', args: [{ func: 'tolower', args: [ref('name')] }, val('steel')] }] }).map(r => r.id)).toEqual(['3'])
    expect(applyQuery(rows, { where: [ref('id'), 'in', { list: [val('1'), val('3')] }] }).map(r => r.id)).toEqual(['1', '3'])
    expect(applyQuery(rows, { where: ['not', ref('blocked'), '=', val(false)] }).map(r => r.id)).toEqual(['2'])
    expect(applyQuery(rows, { where: [ref('name'), 'is', 'not', 'null'] })).toHaveLength(3)
  })

  test('applies key predicates, search, order, paging, count and projection', () => {
    expect(applyQuery(rows, { one: true, from: { ref: [{ id: 'X', where: [ref('id'), '=', val('2')] }] } }))
      .toMatchObject({ name: 'Bharat Office' })
    const result = applyQuery(rows, {
      search: [val('e')], orderBy: [{ ref: ['qty'], sort: 'desc' }],
      limit: { rows: val(1), offset: val(1) }, count: true, columns: [ref('id')]
    })
    expect([...result]).toEqual([{ id: '1' }]) // copy: the array also carries $count
    expect(result.$count).toBe(3)
  })

  test('rejects unsupported expressions with 501', () => {
    expect(() => applyQuery(rows, { where: [{ func: 'substring', args: [] }] })).toThrow(expect.objectContaining({ status: 501 }))
  })

  test('equalityValue and searchText read facade inputs from the query', () => {
    const select = { from: { ref: [{ id: 'X', where: [ref('purchaseOrder'), '=', val('4500000101')] }] }, search: [val('lamp')] }
    expect(equalityValue(select, 'purchaseOrder')).toBe('4500000101')
    expect(equalityValue({ where: [ref('a'), '>', val(1)] }, 'a')).toBeUndefined()
    expect(searchText(select)).toBe('lamp')
  })
})
