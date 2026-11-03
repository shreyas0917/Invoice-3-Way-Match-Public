// Unit tests for the pure parts of srv/lib/status-machine.js and srv/lib/history.js.
const sm = require('../../srv/lib/status-machine')
const { roleOf } = require('../../srv/lib/history')

const STATUSES = [null, 'VALIDATED', 'MATCHED', 'EXCEPTION', 'PENDING_APPROVAL', 'BLOCKED', 'RELEASED', 'CANCELLED']

describe('transition table', () => {
  test.each([
    ['RELEASE', 'MATCHED', 'RELEASED'],
    ['APPROVE', 'PENDING_APPROVAL', 'RELEASED'],
    ['REJECT', 'PENDING_APPROVAL', 'BLOCKED'],
    ['BLOCK', 'VALIDATED', 'BLOCKED'],
    ['BLOCK', 'MATCHED', 'BLOCKED'],
    ['BLOCK', 'EXCEPTION', 'BLOCKED'],
    ['BLOCK', 'PENDING_APPROVAL', 'BLOCKED'],
    ['UNBLOCK', 'BLOCKED', 'VALIDATED'],
    ['CANCEL', 'BLOCKED', 'CANCELLED'],
    ['SUBMIT', null, 'VALIDATED'],
    ['SUBMIT', 'VALIDATED', 'VALIDATED']
  ])('%s from %s -> %s', (action, from, to) => {
    expect(sm.targetStatus(action, from)).toBe(to)
  })

  test('every other (action, status) pair is refused with 409 INVALID_STATUS_TRANSITION', () => {
    for (const [action, { from }] of Object.entries(sm.TRANSITIONS))
      for (const status of STATUSES.filter(s => !from.includes(s)))
        expect(() => sm.assertAllowed(action, status)).toThrow(expect.objectContaining({
          status: 409, code: 'INVALID_STATUS_TRANSITION', args: [action.toLowerCase(), status ?? '-']
        }))
  })

  test('RELEASED and CANCELLED are final: no action starts from them', () => {
    for (const final of sm.FINAL_STATUSES)
      expect(Object.values(sm.TRANSITIONS).some(t => t.from.includes(final))).toBe(false)
  })

  test('BLOCKED can only be left by unblock or cancel', () => {
    const fromBlocked = Object.entries(sm.TRANSITIONS).filter(([, t]) => t.from.includes('BLOCKED')).map(([a]) => a)
    expect(fromBlocked.sort()).toEqual(['CANCEL', 'UNBLOCK'])
  })

  test('actions with several results need the chosen one, and it must be allowed', () => {
    expect(sm.targetStatus('MATCH', 'VALIDATED', 'EXCEPTION')).toBe('EXCEPTION')
    expect(() => sm.targetStatus('MATCH', 'VALIDATED')).toThrow('MATCH cannot lead to undefined')
    expect(() => sm.targetStatus('MATCH', 'VALIDATED', 'RELEASED')).toThrow('MATCH cannot lead to RELEASED')
    expect(() => sm.targetStatus('PAY', 'MATCHED')).toThrow('Unknown invoice action PAY')
  })

  test('only VALIDATED invoices can be edited', () => {
    expect(() => sm.assertEditable('VALIDATED')).not.toThrow()
    for (const status of ['MATCHED', 'EXCEPTION', 'PENDING_APPROVAL', 'BLOCKED', 'RELEASED', 'CANCELLED'])
      expect(() => sm.assertEditable(status)).toThrow(expect.objectContaining({ status: 409, args: ['edit', status] }))
  })
})

describe('exception resolution rules', () => {
  test('resolution compatibility per exception type', () => {
    expect(sm.RESOLUTIONS_BY_TYPE).toEqual({
      PRICE_VARIANCE: ['ACCEPT', 'REMATCH', 'REJECT'],
      QTY_VARIANCE: ['ACCEPT', 'REMATCH', 'REJECT'],
      NO_GR: ['REMATCH', 'REJECT'],
      DUPLICATE_SUSPECT: ['ACCEPT', 'REJECT']
    })
    expect(sm.resolutionAllowed('NO_GR', 'ACCEPT')).toBe(false)
    expect(sm.resolutionAllowed('UNKNOWN', 'ACCEPT')).toBe(false)
  })

  const decided = (...resolutions) => resolutions.map((resolution, i) => ({ ID: `e${i}`, type: 'PRICE_VARIANCE', resolution, resolutionNote: `note ${i}` }))

  test('REJECT wins, then ACCEPT, then REMATCH', () => {
    expect(sm.statusAfterResolution(decided('ACCEPT', 'REJECT', 'REMATCH'))).toEqual({ status: 'BLOCKED', blockReason: 'Exception PRICE_VARIANCE rejected: note 1' })
    expect(sm.statusAfterResolution(decided('REMATCH', 'ACCEPT'))).toEqual({ status: 'PENDING_APPROVAL', approvalReason: 'ACCEPTED_VARIANCE' })
    expect(sm.statusAfterResolution(decided('REMATCH', 'REMATCH'))).toEqual({ status: 'VALIDATED' })
  })

  test('the block reason fits into 255 characters', () => {
    const [long] = decided('REJECT')
    long.resolutionNote = 'x'.repeat(600)
    expect(sm.statusAfterResolution([long]).blockReason).toHaveLength(255)
  })
})

describe('history roles', () => {
  const user = roles => ({ is: role => roles.includes(role) })
  test('the most privileged business role is recorded', () => {
    expect(roleOf(user(['APClerk', 'APManager']))).toBe('APManager')
    expect(roleOf(user(['Buyer']))).toBe('Buyer')
    expect(roleOf(user([]))).toBeNull()
    expect(roleOf(undefined)).toBeNull()
  })
})
