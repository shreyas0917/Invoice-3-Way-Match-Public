// Unit tests for srv/lib/decimal.js (exact money arithmetic).
const { toScaled, format, Ratio } = require('../../srv/lib/decimal')

describe('Ratio', () => {
  test('exact arithmetic without rounding', () => {
    const third = Ratio.of(1).dividedBy(3)
    expect(third.times(3).compare(1)).toBe(0) // 1/3 x 3 is exactly 1
    expect(Ratio.of('0.1').plus('0.2').compare('0.3')).toBe(0)
    expect(Ratio.of(15000).dividedBy(100).toFixed(4)).toBe('150.0000')
    expect(Ratio.of('1020.10').minus(1000).times(100).dividedBy(1000).toFixed(4)).toBe('2.0100')
  })

  test('sign, abs, lte and rounding half away from zero', () => {
    expect(Ratio.of('-2.5').sign()).toBe(-1)
    expect(Ratio.of(0).sign()).toBe(0)
    expect(Ratio.of('-2.5').abs().toFixed(1)).toBe('2.5')
    expect(Ratio.of('2.00').lte('2')).toBe(true)
    expect(Ratio.of(2).dividedBy(3).toFixed(2)).toBe('0.67')
    expect(Ratio.of(-2).dividedBy(3).toFixed(2)).toBe('-0.67')
    expect(Ratio.of('0.125').toFixed(2)).toBe('0.13')
    expect(Ratio.of(null)).toBeNull()
  })

  test('division by zero is an error', () => {
    expect(() => Ratio.of(1).dividedBy(0)).toThrow(RangeError)
  })
})

describe('decimal helpers', () => {
  test('parse strings and numbers exactly', () => {
    expect(toScaled('1500.00', 2)).toBe(150000n)
    expect(toScaled(0.1, 2) + toScaled(0.2, 2)).toBe(toScaled(0.3, 2)) // unlike 0.1 + 0.2 in floating point
    expect(toScaled('2.000', 3)).toBe(2000n)
    expect(toScaled('-4.5', 2)).toBe(-450n)
    expect(toScaled(1e-7, 2)).toBe(0n)
    expect(toScaled(null, 2)).toBeNull()
  })

  test('round half away from zero beyond the scale', () => {
    expect(toScaled('1.005', 2)).toBe(101n)
    expect(toScaled('-1.005', 2)).toBe(-101n)
    expect(toScaled('1.004', 2)).toBe(100n)
  })

  test('reject non-numbers', () => {
    expect(() => toScaled('12a', 2)).toThrow(TypeError)
    expect(() => toScaled('.', 2)).toThrow(TypeError)
  })

  test('format back to text', () => {
    expect(format(150000n, 2)).toBe('1500.00')
    expect(format(5n, 2)).toBe('0.05')
    expect(format(-450n, 2)).toBe('-4.50')
  })
})
