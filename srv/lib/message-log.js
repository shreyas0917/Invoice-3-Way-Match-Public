/**
 * MessageLog writer: technical log of calls to S/4HANA (through the facade).
 *
 * The log must survive when the business transaction rolls back - a failed S/4 call is
 * exactly what has to stay visible. Rows are therefore never written in the request's
 * transaction. During a request they are collected and written in a NEW transaction with
 * its own commit when the request's transaction has ended (committed or rolled back).
 *
 * Why not a nested transaction right away: with SQLite (one connection for an in-memory
 * database, a single writer otherwise) a second transaction cannot write while the
 * request's transaction is still open - it would wait for it forever. Writing after the
 * end works on every database. Limitation: a process crash between the S/4 call and the
 * end of the request loses those rows.
 */
const cds = require('@sap/cds')

const pendingByContext = new WeakMap()
const ENDED = Symbol('transaction ended')

/**
 * Records one log row. Inside a request: written when its transaction ends.
 * Outside a transaction, or after it ended (a call that finished late): written immediately
 * in its own transaction - a row is never dropped.
 * @param {object} entry { correlationID, direction, targetSystem, operation, invoice_ID, status, durationMs, errorMessage }
 */
async function record(entry) {
  const context = cds.context
  if (!context?.tx || pendingByContext.get(context) === ENDED) return write([entry])
  let pending = pendingByContext.get(context)
  if (!pending) {
    pending = []
    pendingByContext.set(context, pending)
    context.on('done', () => {
      pendingByContext.set(context, ENDED)
      return write(pending)
    })
  }
  pending.push(entry)
}

/** Inserts rows in a new root transaction, independent of any request transaction. */
async function write(rows) {
  if (!rows.length) return
  const { MessageLog } = cds.entities('ap')
  try {
    // A fresh context object makes cds.tx start a new root transaction (not a nested one).
    await cds.tx({ user: cds.User.privileged }, tx => tx.run(INSERT.into(MessageLog).entries(rows)))
  } catch (error) {
    // Logging must never break the business request; report it to the server log instead.
    cds.log('message-log').error('Could not write MessageLog rows:', error.message)
  }
}

module.exports = { record }
