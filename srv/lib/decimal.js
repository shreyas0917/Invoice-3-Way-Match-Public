/**
 * Decimal-safe arithmetic for money and quantities.
 *
 * JavaScript numbers are binary floating point: 0.1 + 0.2 !== 0.3. Amounts are
 * therefore converted to BigInt counts of their smallest unit (scale 2 -> paise/cents,
 * scale 3 -> thousandths) and compared exactly. Values may arrive as strings
 * ("1500.00", as CAP reads Decimal columns) or as numbers (from JSON input).
 */

/**
 * Converts a decimal value to a BigInt of 10^-scale units, e.g. toScaled('12.3', 2) === 1230n.
 * Rounds half away from zero if the value has more decimals than `scale`.
 * Returns null for null/undefined/'' and throws on anything that is not a decimal number.
 */
function toScaled(value, scale) {
  if (value === null || value === undefined || value === '') return null
  let text = typeof value === 'number' ? numberToPlain(value) : String(value).trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && !match[3])) throw new TypeError(`Not a decimal number: ${value}`)
  const [, sign, whole, fraction = ''] = match
  const kept = fraction.slice(0, scale).padEnd(scale, '0')
  let scaled = BigInt((whole || '0') + kept)
  if (fraction.length > scale && fraction[scale] >= '5') scaled += 1n // half away from zero
  return sign === '-' ? -scaled : scaled
}

/** Absolute value of a BigInt. */
function abs(n) {
  return n < 0n ? -n : n
}

/** Formats a scaled BigInt back to a decimal string, e.g. format(1230n, 2) === '12.30'. */
function format(scaled, scale) {
  const negative = scaled < 0n
  const digits = abs(scaled).toString().padStart(scale + 1, '0')
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  return negative ? `-${text}` : text
}

/** Number -> plain decimal string without exponent (1e-7 -> '0.0000001'). */
function numberToPlain(n) {
  if (!Number.isFinite(n)) throw new TypeError(`Not a decimal number: ${n}`)
  const text = String(n)
  if (!/e/i.test(text)) return text
  return n.toFixed(20).replace(/\.?0+$/, '')
}

/**
 * Exact fraction of two BigInts, for calculations that divide (unit price =
 * netPrice / priceUnit, variance % = difference / price × 100). Nothing is rounded
 * until a value is stored or displayed with toFixed().
 */
class Ratio {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new RangeError('Division by zero')
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator }
    const divisor = gcd(abs(numerator), denominator)
    this.n = numerator / divisor
    this.d = denominator / divisor
  }

  /** Ratio from a decimal value (string or number); null stays null. */
  static of(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Ratio) return value
    const text = typeof value === 'number' ? numberToPlain(value) : String(value).trim()
    const scale = (text.split('.')[1] ?? '').length
    return new Ratio(toScaled(text, scale), 10n ** BigInt(scale))
  }

  plus(other) { other = Ratio.of(other); return new Ratio(this.n * other.d + other.n * this.d, this.d * other.d) }
  minus(other) { other = Ratio.of(other); return new Ratio(this.n * other.d - other.n * this.d, this.d * other.d) }
  times(other) { other = Ratio.of(other); return new Ratio(this.n * other.n, this.d * other.d) }
  dividedBy(other) { other = Ratio.of(other); return new Ratio(this.n * other.d, this.d * other.n) }
  abs() { return new Ratio(abs(this.n), this.d) }
  sign() { return this.n > 0n ? 1 : this.n < 0n ? -1 : 0 }
  compare(other) { other = Ratio.of(other); const diff = this.n * other.d - other.n * this.d; return diff > 0n ? 1 : diff < 0n ? -1 : 0 }
  lte(other) { return this.compare(other) <= 0 }

  /** Decimal string with `scale` decimals, rounded half away from zero. */
  toFixed(scale) {
    const factor = 10n ** BigInt(scale)
    const scaled = this.n * factor, quotient = scaled / this.d, remainder = scaled % this.d
    const rounded = abs(remainder) * 2n >= this.d ? quotient + (scaled < 0n ? -1n : 1n) : quotient
    return format(rounded, scale)
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b]
  return a || 1n
}

module.exports = { toScaled, abs, format, Ratio }
