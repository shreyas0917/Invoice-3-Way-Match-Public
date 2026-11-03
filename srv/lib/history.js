/**
 * ApprovalHistory writer: one insert-only row per business decision.
 *
 * Runs in the caller's transaction, so a rolled-back action leaves no history row.
 * Takes a cds.User rather than a request, so it can be used from any service handler
 * (and later from scheduled jobs) without depending on HTTP.
 */
const cds = require('@sap/cds')

/** Business roles, most privileged first; the first one the user has is recorded. */
const BUSINESS_ROLES = Object.freeze(['APManager', 'Buyer', 'APClerk'])

/** The actor's business role, or null (e.g. mocked users without one, or technical users). */
function roleOf(user) {
  return BUSINESS_ROLES.find(role => user?.is?.(role)) ?? null
}

/**
 * @param {object} o
 * @param {string} o.invoiceID
 * @param {string} [o.exceptionID]
 * @param {string} o.action      SUBMIT, MATCH, RESOLVE, APPROVE, REJECT, RELEASE, BLOCK, UNBLOCK, CANCEL
 * @param {string} [o.fromStatus]
 * @param {string} o.toStatus
 * @param {object} o.user        cds.User of the actor
 * @param {string} [o.comment]   reason or comment, cut to 500 characters
 */
async function writeHistory({ invoiceID, exceptionID, action, fromStatus, toStatus, user, comment }) {
  const { ApprovalHistory } = cds.entities('ap')
  await INSERT.into(ApprovalHistory).entries({
    invoice_ID: invoiceID,
    exception_ID: exceptionID ?? null,
    action,
    fromStatus: fromStatus ?? null,
    toStatus,
    actor: user?.id ?? 'unknown',
    actorRole: roleOf(user),
    comment: comment ? String(comment).slice(0, 500) : null,
    at: new Date().toISOString()
  })
}

module.exports = { writeHistory, roleOf, BUSINESS_ROLES }
