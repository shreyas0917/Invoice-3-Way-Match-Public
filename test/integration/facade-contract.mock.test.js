// Phase 10: facade contract (facade-contract.js) against the MOCK implementation (default).
const cds = require('@sap/cds')
const path = require('path')
const facadeContract = require('./facade-contract')

cds.test(path.join(__dirname, '../..'))

// The mock's "backend" is its s4mock tables: a breaker on the database reads of suppliers.
let breaker = null
beforeAll(() => cds.db.prepend(db => db.on('READ', (req, next) =>
  breaker && req.target?.name === 's4mock.Suppliers' ? breaker() : next())))

describe('ExternalPurchaseOrderService contract - mock-po-service.js', () => facadeContract({
  className: 'MockPurchaseOrderService',
  targetSystem: 'S4_MOCK',
  country: supplierID => ({ 1000010: 'IN' })[supplierID],
  breakBackend: (_, fn) => { breaker = fn; return () => { breaker = null } }
}))
