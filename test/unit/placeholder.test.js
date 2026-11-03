// Phase 0 smoke test: proves Jest runs and the CAP runtime can be loaded.
const cds = require('@sap/cds')

describe('project skeleton', () => {
  test('CAP runtime loads', () => {
    expect(typeof cds.version).toBe('string')
  })
})
