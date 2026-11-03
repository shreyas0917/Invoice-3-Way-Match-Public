/**
 * Answers an OData READ from a plain array instead of a database table.
 *
 * Value-help entities (Suppliers, PurchaseOrders, PurchaseOrderItems) are backed by
 * the S/4 facade, which returns lists. Fiori still sends normal OData queries
 * ($filter, $search, $orderby, $top, $skip, $count, key reads), so this module
 * applies the CQN query of the request to the list in memory.
 *
 * Supported: key predicates, comparisons (= != < > <= >=), and/or/not, parentheses,
 * in (...), is [not] null, contains/startswith/endswith/tolower/toupper, $search,
 * $orderby, $top/$skip, $count, $select. Anything else is rejected with 501.
 *
 * Pure functions, no CAP request objects: unit-testable on their own.
 */

/**
 * Applies a CQN SELECT to rows.
 * @param {object[]} rows   full candidate list
 * @param {object}  select  the request's query.SELECT
 * @returns {object|object[]} one row (for key reads / SELECT.one) or an array with $count
 */
function applyQuery(rows, select) {
  const where = whereOf(select)
  let result = where.length ? rows.filter(row => truthy(evaluate(where, row))) : [...rows]

  const terms = searchTerms(select)
  if (terms.length) result = result.filter(row => matchesSearch(row, terms))

  if (select.orderBy?.length) result.sort(comparator(select.orderBy))

  if (select.one) return project(result[0], select.columns)

  const total = result.length
  const limit = select.limit
  if (limit) {
    const offset = limit.offset?.val ?? 0
    const top = limit.rows?.val
    result = result.slice(offset, top === undefined ? undefined : offset + top)
  }
  result = result.map(row => project(row, select.columns))
  if (select.count) result.$count = total
  return result
}

/**
 * Value of `element` if the query pins it with an equality (key predicate or a
 * top-level `element = value` in $filter); otherwise undefined. Used to pass the most
 * selective input to the facade before filtering in memory.
 */
function equalityValue(select, element) {
  const where = whereOf(select)
  for (let i = 0; i < where.length - 2; i++) {
    const [a, op, b] = where.slice(i, i + 3)
    if (op !== '=' && op !== '==') continue
    if (a?.ref?.at(-1) === element && b && 'val' in b) return b.val
    if (b?.ref?.at(-1) === element && a && 'val' in a) return a.val
  }
  return undefined
}

/** The $search text as one string ('' if none). */
function searchText(select) {
  return searchTerms(select).join(' ')
}

// --- internals ---------------------------------------------------------------

/** Key predicate (Suppliers('1')) and $filter, combined with "and". */
function whereOf(select) {
  const keys = select.from?.ref?.[0]?.where ?? []
  const filter = select.where ?? []
  if (keys.length && filter.length) return [{ xpr: keys }, 'and', { xpr: filter }]
  return keys.length ? keys : filter
}

function searchTerms(select) {
  const terms = []
  const collect = tokens => {
    for (const t of tokens ?? []) {
      if (t && 'val' in t) terms.push(String(t.val))
      else if (t?.xpr) collect(t.xpr)
    }
  }
  collect(select.search)
  return terms.map(t => t.trim()).filter(Boolean)
}

/** Every term must appear (case-insensitive) in at least one string property. */
function matchesSearch(row, terms) {
  const haystack = Object.values(row)
    .filter(v => typeof v === 'string')
    .join('\u0000')
    .toLowerCase()
  return terms.every(term => haystack.includes(term.toLowerCase()))
}

function comparator(orderBy) {
  return (a, b) => {
    for (const { ref, sort } of orderBy) {
      const name = ref?.at(-1)
      const x = a[name], y = b[name]
      if (x === y) continue
      const direction = sort === 'desc' ? -1 : 1
      if (x === null || x === undefined) return -direction
      if (y === null || y === undefined) return direction
      return (x < y ? -1 : 1) * direction
    }
    return 0
  }
}

function project(row, columns) {
  if (!row || !columns?.length || columns.some(c => c === '*')) return row
  const names = columns.map(c => c.as ?? c.ref?.at(-1)).filter(Boolean)
  if (!names.length) return row
  return Object.fromEntries(names.map(n => [n, row[n]]))
}

/** Evaluates a CQN expression token list against one row. */
function evaluate(tokens, row) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  const orExpr = () => {
    let value = andExpr()
    while (peek() === 'or') { next(); const rhs = andExpr(); value = truthy(value) || truthy(rhs) }
    return value
  }
  const andExpr = () => {
    let value = notExpr()
    while (peek() === 'and') { next(); const rhs = notExpr(); value = truthy(value) && truthy(rhs) }
    return value
  }
  const notExpr = () => {
    if (peek() === 'not') { next(); return !truthy(notExpr()) }
    return comparison()
  }
  const comparison = () => {
    const left = operand(next())
    const op = peek()
    if (op === 'is') {
      next()
      const negated = peek() === 'not' && next()
      if (next() !== 'null') unsupported('is')
      const isNull = left === null || left === undefined
      return negated ? !isNull : isNull
    }
    if (op === 'in' || (op === 'not' && tokens[pos + 1] === 'in')) {
      const negated = op === 'not' && next()
      next()
      const list = operand(next())
      const found = Array.isArray(list) && list.some(v => equals(left, v))
      return negated ? !found : found
    }
    if (!['=', '==', '!=', '<>', '<', '>', '<=', '>='].includes(op)) return left
    next()
    const right = operand(next())
    switch (op) {
      case '=': case '==': return equals(left, right)
      case '!=': case '<>': return !equals(left, right)
      case '<': return left < right
      case '>': return left > right
      case '<=': return left <= right
      case '>=': return left >= right
    }
  }

  const value = orExpr()
  if (pos < tokens.length) unsupported(tokens[pos])
  return value

  function operand(token) {
    if (token === undefined) unsupported('end of expression')
    if (token.ref) return row[token.ref.at(-1)]
    if ('val' in token) return token.val
    if (token.list) return token.list.map(t => operand(t))
    if (token.xpr) return evaluate(token.xpr, row)
    if (token.func) return callFunction(token.func, (token.args ?? []).map(a => operand(a)))
    unsupported(JSON.stringify(token))
  }
}

function callFunction(name, args) {
  const s = v => (v === null || v === undefined ? '' : String(v))
  switch (name.toLowerCase()) {
    case 'contains': return s(args[0]).includes(s(args[1]))
    case 'startswith': return s(args[0]).startsWith(s(args[1]))
    case 'endswith': return s(args[0]).endsWith(s(args[1]))
    case 'tolower': return s(args[0]).toLowerCase()
    case 'toupper': return s(args[0]).toUpperCase()
    default: unsupported(name)
  }
}

/** Loose equality so '50' (from URL) and 50 (from the facade) compare equal. */
function equals(a, b) {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  return false
}

function truthy(v) {
  return v === true
}

function unsupported(what) {
  const error = new Error(`Value help query not supported: ${what}`)
  error.status = 501
  error.code = 'VALUE_HELP_QUERY_NOT_SUPPORTED'
  throw error
}

module.exports = { applyQuery, equalityValue, searchText }
