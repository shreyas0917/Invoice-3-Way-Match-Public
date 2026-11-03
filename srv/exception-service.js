/**
 * ExceptionService handlers: resolve an exception and, when it was the last open one of
 * the invoice's current match run, recompute the invoice status through the status machine.
 */
const cds = require('@sap/cds')
const statusMachine = require('./lib/status-machine')
const { applyQuery } = require('./lib/value-help')

const RESOLUTIONS = ['ACCEPT', 'REMATCH', 'REJECT']

module.exports = class ExceptionService extends cds.ApplicationService {
  init() {
    const { Exceptions, AllowedResolutions } = this.entities
    const { Exceptions: SavedExceptions, Invoices, ExceptionResolutions } = cds.entities('ap')

    // Value help of the resolve dialog, from the status machine's own table.
    this.on('READ', AllowedResolutions, async req => {
      const names = await SELECT.from(ExceptionResolutions).columns('code', 'name')
      const rows = Object.entries(statusMachine.RESOLUTIONS_BY_TYPE).flatMap(([exceptionType, resolutions]) =>
        resolutions.map(resolution => ({ exceptionType, resolution, name: names.find(n => n.code === resolution)?.name ?? resolution })))
      return applyQuery(rows, req.query.SELECT)
    })

    // 1. read exception and invoice (row locks)  2. validate state, resolution and note
    // 3. resolve  4. recompute the invoice if this was the last open exception of its run
    // 5. history (inside transition). One transaction: any error rolls everything back.
    this.on('resolve', Exceptions, async req => {
      const { ID } = req.params[0]
      const resolution = req.data.resolution
      const note = req.data.note?.trim()

      const exception = await SELECT.one.from(SavedExceptions).where({ ID }).forUpdate()
      if (!exception) return req.reject(404)
      if (exception.status !== 'OPEN')
        return req.reject({ status: 409, code: 'EXCEPTION_NOT_OPEN', message: 'EXCEPTION_NOT_OPEN', args: [exception.status] })
      if (!RESOLUTIONS.includes(resolution))
        return req.reject({ status: 400, code: 'INVALID_RESOLUTION', message: 'INVALID_RESOLUTION', args: [resolution ?? '-'], target: 'resolution' })
      if (!statusMachine.resolutionAllowed(exception.type, resolution))
        return req.reject({ status: 400, code: 'RESOLUTION_NOT_ALLOWED', message: 'RESOLUTION_NOT_ALLOWED', args: [resolution, exception.type], target: 'resolution' })
      if (!note)
        return req.reject({ status: 400, code: 'NOTE_REQUIRED', message: 'NOTE_REQUIRED', target: 'note' })

      const invoice = await SELECT.one.from(Invoices).where({ ID: exception.invoice_ID }).forUpdate()
      statusMachine.assertAllowed('RESOLVE', invoice.status) // e.g. a BLOCKED invoice: 409

      await UPDATE(SavedExceptions, ID).set({
        status: 'RESOLVED', resolution, resolutionNote: note,
        resolvedBy: req.user.id, resolvedAt: new Date().toISOString()
      })

      // Only the exceptions of the invoice's current match run decide its outcome.
      const run = await SELECT.from(SavedExceptions).columns('ID', 'type', 'status', 'resolution', 'resolutionNote')
        .where({ invoice_ID: invoice.ID, runID: exception.runID })
      const stillOpen = run.some(e => e.status === 'OPEN')
      const outcome = stillOpen ? { status: 'EXCEPTION' } : statusMachine.statusAfterResolution(run)

      await statusMachine.transition({
        invoice, action: 'RESOLVE', to: outcome.status, user: req.user, exceptionID: ID,
        comment: `${resolution} ${exception.type}: ${note}`,
        set: { approvalReason: outcome.approvalReason, blockReason: outcome.blockReason }
      })

      return this.run(SELECT.one.from(Exceptions).where({ ID }))
    })

    return super.init()
  }
}
