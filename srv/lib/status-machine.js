/**
 * Invoice status machine - the single source of truth for invoice status changes
 * (blueprint "Business workflow and rules").
 *
 *   TRANSITIONS          which action may move an invoice from which status to which
 *   targetStatus()       validates a transition (409 INVALID_STATUS_TRANSITION) - pure
 *   assertEditable()     only VALIDATED invoices can be edited again - pure
 *   resolutionAllowed()  which resolution fits which exception type - pure
 *   statusAfterResolution()  invoice outcome once its last open exception is decided - pure
 *   transition()         the ONLY function that writes Invoices.status after submission:
 *                        validates, updates the row (guarded by the expected old status)
 *                        and writes the ApprovalHistory row, in the caller's transaction
 *
 * The first status (SUBMIT on draft activation) is written by CAP's draft activation
 * itself; the handler takes its value from targetStatus('SUBMIT', ...) and writes the
 * history row with srv/lib/history.js.
 */
const cds = require('@sap/cds')
const { writeHistory } = require('./history')

const TRANSITIONS = Object.freeze({
  SUBMIT:  { from: [null, 'VALIDATED'], to: ['VALIDATED'] }, // null = first save of a new invoice
  MATCH:   { from: ['VALIDATED'], to: ['MATCHED', 'PENDING_APPROVAL', 'EXCEPTION'] },
  // An exception decided while others stay open keeps the invoice in EXCEPTION.
  RESOLVE: { from: ['EXCEPTION'], to: ['EXCEPTION', 'BLOCKED', 'PENDING_APPROVAL', 'VALIDATED'] },
  RELEASE: { from: ['MATCHED'], to: ['RELEASED'] },
  APPROVE: { from: ['PENDING_APPROVAL'], to: ['RELEASED'] },
  REJECT:  { from: ['PENDING_APPROVAL'], to: ['BLOCKED'] },
  BLOCK:   { from: ['VALIDATED', 'MATCHED', 'EXCEPTION', 'PENDING_APPROVAL'], to: ['BLOCKED'] },
  UNBLOCK: { from: ['BLOCKED'], to: ['VALIDATED'] },
  CANCEL:  { from: ['BLOCKED'], to: ['CANCELLED'] }
})

const FINAL_STATUSES = Object.freeze(['RELEASED', 'CANCELLED'])
const EDITABLE_STATUSES = Object.freeze(['VALIDATED'])

/** Which resolution may close which exception type (blueprint workflow 9). */
const RESOLUTIONS_BY_TYPE = Object.freeze({
  PRICE_VARIANCE: ['ACCEPT', 'REMATCH', 'REJECT'],
  QTY_VARIANCE: ['ACCEPT', 'REMATCH', 'REJECT'],
  NO_GR: ['REMATCH', 'REJECT'], // nothing is paid without a goods receipt
  DUPLICATE_SUSPECT: ['ACCEPT', 'REJECT'] // ACCEPT = "not a duplicate"
})

/** 409 error for an action that is not allowed in the current status. */
function invalidTransition(action, fromStatus) {
  return Object.assign(new Error('INVALID_STATUS_TRANSITION'), {
    status: 409, code: 'INVALID_STATUS_TRANSITION', args: [action.toLowerCase(), fromStatus ?? '-']
  })
}

/**
 * Validates `action` from `fromStatus` and returns the resulting status.
 * Actions with several possible results (MATCH, RESOLVE) must name the one they chose.
 * @throws 409 INVALID_STATUS_TRANSITION
 */
function targetStatus(action, fromStatus, chosen) {
  assertAllowed(action, fromStatus)
  const transition = TRANSITIONS[action]
  const to = chosen ?? (transition.to.length === 1 ? transition.to[0] : undefined)
  if (!transition.to.includes(to)) throw new Error(`${action} cannot lead to ${to}`) // programming error
  return to
}

/**
 * Early guard: may `action` start from `fromStatus`? Used before an action does its work
 * (e.g. before match reads S/4); transition() checks again when it writes.
 * @throws 409 INVALID_STATUS_TRANSITION
 */
function assertAllowed(action, fromStatus) {
  const transition = TRANSITIONS[action]
  if (!transition) throw new Error(`Unknown invoice action ${action}`)
  if (!transition.from.includes(fromStatus ?? null)) throw invalidTransition(action, fromStatus)
}

/** Editing (a new draft of a submitted invoice) is allowed only in VALIDATED. @throws 409 */
function assertEditable(status) {
  if (!EDITABLE_STATUSES.includes(status)) throw invalidTransition('EDIT', status)
}

/** Whether `resolution` may close an exception of `type`. */
function resolutionAllowed(type, resolution) {
  return (RESOLUTIONS_BY_TYPE[type] ?? []).includes(resolution)
}

/**
 * Invoice outcome after its last open exception is decided (blueprint workflow 9):
 * any REJECT -> BLOCKED (reason names the rejected exception); else any ACCEPT ->
 * PENDING_APPROVAL (ACCEPTED_VARIANCE); else (all REMATCH) -> VALIDATED, ready to match.
 * @param exceptions the decided exceptions of the current match run: { ID, type, resolution, resolutionNote }
 */
function statusAfterResolution(exceptions) {
  const rejected = exceptions.find(e => e.resolution === 'REJECT')
  if (rejected)
    return {
      status: 'BLOCKED',
      blockReason: `Exception ${rejected.type} rejected: ${rejected.resolutionNote}`.slice(0, 255)
    }
  if (exceptions.some(e => e.resolution === 'ACCEPT'))
    return { status: 'PENDING_APPROVAL', approvalReason: 'ACCEPTED_VARIANCE' }
  return { status: 'VALIDATED' }
}

/**
 * Changes an invoice's status and writes its ApprovalHistory row, in the current transaction.
 * The UPDATE is guarded by the expected old status, so a concurrent change cannot be
 * overwritten (409). Side fields follow the status: approvalReason only in PENDING_APPROVAL,
 * blockReason in BLOCKED (kept in CANCELLED); returning to VALIDATED detaches the last match
 * run, so old results are never shown as current - they stay in MatchResults for audit.
 *
 * @param {object} o
 * @param {object} o.invoice       the invoice as read (needs ID and status)
 * @param {string} o.action        a TRANSITIONS key
 * @param {string} [o.to]          chosen result for MATCH and RESOLVE
 * @param {object} [o.set]         extra fields: approvalReason, blockReason, lastMatchRunID, lastMatchAt
 * @param {object} o.user          cds.User of the actor
 * @param {string} [o.comment]     reason or comment for the history row
 * @param {string} [o.exceptionID] RESOLVE: the exception decided
 * @returns {Promise<string>} the new status
 */
async function transition({ invoice, action, to, set = {}, user, comment, exceptionID }) {
  const { Invoices, InvoiceItems } = cds.entities('ap')
  const fromStatus = invoice.status ?? null
  const toStatus = targetStatus(action, fromStatus, to)

  const data = {
    ...set,
    status: toStatus,
    approvalReason: toStatus === 'PENDING_APPROVAL' ? (set.approvalReason ?? invoice.approvalReason ?? null) : null,
    blockReason: ['BLOCKED', 'CANCELLED'].includes(toStatus) ? (set.blockReason ?? invoice.blockReason ?? null) : null
  }
  if (toStatus === 'VALIDATED') {
    data.lastMatchRunID = null
    await UPDATE(InvoiceItems).set({ matchStatus: 'NOT_MATCHED' }).where({ up__ID: invoice.ID })
  }

  const changed = await UPDATE(Invoices).set(data).where({ ID: invoice.ID, status: fromStatus })
  if (changed !== 1) throw invalidTransition(action, `${fromStatus} (changed concurrently)`)

  await writeHistory({ invoiceID: invoice.ID, exceptionID, action, fromStatus, toStatus, user, comment })
  return toStatus
}

module.exports = {
  TRANSITIONS, FINAL_STATUSES, EDITABLE_STATUSES, RESOLUTIONS_BY_TYPE,
  targetStatus, assertAllowed, assertEditable, resolutionAllowed, statusAfterResolution, transition, invalidTransition
}
