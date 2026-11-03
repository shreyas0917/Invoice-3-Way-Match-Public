/**
 * Base class of every ExternalPurchaseOrderService implementation (mock now, S/4 adapter in
 * phase 10). It installs the facade guard - timeout, MessageLog, S4_UNAVAILABLE - before the
 * implementation's own handlers, so no implementation can skip it.
 * Subclasses set `static targetSystem` ('S4_MOCK' for the mock, 'S4' for the real system), or
 * `this.targetSystem` in init() before calling super.init() when it is only known at runtime
 * (the S/4 adapter: 'S4' with remote APIs, 'S4_CAP_MOCK' with CAP's local mocks of them).
 */
const cds = require('@sap/cds')
const guard = require('./facade-guard')

module.exports = class FacadeService extends cds.ApplicationService {
  static targetSystem = 'S4'

  init() {
    guard.install(this, { targetSystem: this.targetSystem ?? this.constructor.targetSystem })
    return super.init()
  }
}
