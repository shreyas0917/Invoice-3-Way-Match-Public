/**
 * MatchingEngine implementation: a thin CAP wrapper around the pure function in
 * srv/lib/matching.js. No database access, no HTTP, no request-specific state.
 */
const cds = require('@sap/cds')
const { evaluateInvoice } = require('./lib/matching')

module.exports = class MatchingEngine extends cds.ApplicationService {
  init() {
    this.on('evaluate', req => evaluateInvoice({
      invoice: req.data.invoice,
      purchaseOrder: req.data.purchaseOrder,
      receivedQuantities: req.data.receivedQuantities ?? [],
      invoicedQuantities: req.data.invoicedQuantities ?? [],
      toleranceRules: req.data.toleranceRules ?? [],
      approvalPolicy: req.data.approvalPolicy ?? null,
      possibleDuplicates: req.data.possibleDuplicates ?? []
    }))
    return super.init()
  }
}
