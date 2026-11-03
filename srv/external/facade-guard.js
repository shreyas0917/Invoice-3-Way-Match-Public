/**
 * Guard for every call to S/4HANA through ExternalPurchaseOrderService (blueprint
 * "Facade contract": timeout, one MessageLog row per call, failures -> S4_UNAVAILABLE).
 *
 * Installed by FacadeService (srv/external/facade-service.js) as the first `on` handler, so it
 * wraps every operation of every implementation - the mock today, the real adapter later -
 * and no caller can bypass it.
 *
 *   timeout   5 s by default (cds.requires.ExternalPurchaseOrderService.timeout); the operation
 *             gets an AbortSignal (req.abortSignal) and is aborted when the time is up
 *   errors    a business "not found" (404) passes through unchanged; data the implementation
 *             refuses as permanently unsupported (error.permanent, e.g. an unknown movement type)
 *             becomes 502 S4_DATA_UNSUPPORTED - retrying cannot help; every other failure becomes
 *             503 S4_UNAVAILABLE - the cause stays in the log, never in the user's message
 *   log       one row per call: correlation ID of the user request (cds.context.id), operation,
 *             invoice (header x-invoice-id), SUCCESS/FAILED, duration, sanitized error text;
 *             a failure is also written to the server console, sanitized the same way
 */
const cds = require('@sap/cds')
const { record } = require('../lib/message-log')
const LOG = cds.log('s4-facade')

const DEFAULT_TIMEOUT_MS = 5000

/** Error raised when an operation exceeds its time limit. */
class FacadeTimeout extends Error {
  constructor(ms) { super(`Timeout after ${ms} ms`); this.code = 'FACADE_TIMEOUT' }
}

/**
 * Runs `operation(signal)` with a time limit. On timeout the signal is aborted and the promise
 * rejects with FacadeTimeout; the timer is always cleared, so nothing is left running.
 */
async function withTimeout(operation, ms) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new FacadeTimeout(ms)) }, ms)
  })
  try {
    return await Promise.race([operation(controller.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Error text for the log: no URLs, credentials, tokens or payloads; at most 300 characters. */
function sanitize(error) {
  const text = `${error?.code ? error.code + ': ' : ''}${String(error?.message ?? error).split('\n')[0]}`
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b(bearer|basic)\s+[\w\-.~+/]+=*/gi, '$1 <redacted>')
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key|client_secret|authorization)\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .slice(0, 300)
}

/** Installs the guard as the first handler of a facade service instance. */
function install(srv, { targetSystem }) {
  srv.prepend(() => srv.on('*', async (req, next) => {
    const started = performance.now()
    const timeoutMs = cds.env.requires.ExternalPurchaseOrderService?.timeout ?? DEFAULT_TIMEOUT_MS
    const correlationID = cds.context?.id ?? cds.utils.uuid()
    let status = 'SUCCESS', errorMessage = null
    try {
      return await withTimeout(signal => { req.abortSignal = signal; return next() }, timeoutMs)
    } catch (error) {
      if (error.status === 404) throw error // a business answer ("does not exist"), not a failure
      status = 'FAILED'
      errorMessage = sanitize(error)
      LOG.warn(`${targetSystem} ${req.event} failed (correlation ${correlationID}): ${errorMessage}`)
      if (error.permanent)
        return req.reject({ status: 502, code: 'S4_DATA_UNSUPPORTED', message: 'S4_DATA_UNSUPPORTED' })
      return req.reject({ status: 503, code: 'S4_UNAVAILABLE', message: 'S4_UNAVAILABLE' })
    } finally {
      await record({
        correlationID,
        direction: 'OUT',
        targetSystem,
        operation: req.event,
        invoice_ID: req.headers?.['x-invoice-id'] ?? null,
        status,
        durationMs: Math.round(performance.now() - started),
        errorMessage
      })
    }
  }))
}

module.exports = { install, withTimeout, sanitize, FacadeTimeout, DEFAULT_TIMEOUT_MS }
