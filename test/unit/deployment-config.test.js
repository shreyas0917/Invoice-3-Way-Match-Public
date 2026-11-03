// Phase 11: the SAP BTP deployment configuration, checked without a BTP account -
// xs-security.json against the roles the model really uses, mta.yaml, the App Router routes and
// the effective production configuration (computed by `cds env --profile production`).
const cds = require('@sap/cds')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
const YAML = require(require.resolve('yaml', { paths: [path.dirname(require.resolve('@sap/cds-dk/package.json'))] }))
const cdsCli = require.resolve('@sap/cds-dk/bin/cds.js')
// --json: the default output format differs between platforms (JSON on Windows, not on the Linux CI runner)
const productionEnv = key => JSON.parse(execFileSync(process.execPath, [cdsCli, 'env', key, '--json', '--profile', 'production'], { cwd: ROOT, encoding: 'utf8' }))

const xsSecurity = JSON.parse(read('xs-security.json'))
const mta = YAML.parse(read('mta.yaml'))
const xsApp = JSON.parse(read('.deploy/app-router/xs-app.json'))
const PSEUDO_ROLES = new Set(['authenticated-user', 'any', 'system-user', 'internal-user', 'identified-user'])

/** All roles named in @requires / @restrict of the served model. */
async function rolesUsedInModel() {
  const model = await cds.load(['srv', 'app/services'].map(p => path.join(ROOT, p)))
  const roles = new Set()
  const add = to => [].concat(to ?? []).forEach(role => roles.add(role))
  for (const def of Object.values(model.definitions)) {
    add(def['@requires'])
    for (const rule of def['@restrict'] ?? []) add(rule.to)
    for (const action of Object.values(def.actions ?? {})) {
      add(action['@requires'])
      for (const rule of action['@restrict'] ?? []) add(rule.to)
    }
  }
  return [...roles].filter(role => !PSEUDO_ROLES.has(role)).sort()
}

describe('xs-security.json (XSUAA)', () => {
  test('one scope and one role template per application role - exactly the roles the model uses', async () => {
    const used = await rolesUsedInModel()
    expect(used).toEqual(['APClerk', 'APManager', 'Buyer'])
    expect(xsSecurity.scopes.map(s => s.name).sort()).toEqual(used.map(r => `$XSAPPNAME.${r}`))
    expect(xsSecurity['role-templates'].map(t => t.name).sort()).toEqual(used)
    for (const t of xsSecurity['role-templates']) expect(t['scope-references']).toEqual([`$XSAPPNAME.${t.name}`])
  })

  test('purchasingGroup is a required attribute of the Buyer role template only', () => {
    expect(xsSecurity.attributes).toEqual([expect.objectContaining({ name: 'purchasingGroup', valueRequired: true })])
    const withAttributes = xsSecurity['role-templates'].filter(t => t['attribute-references']?.length)
    expect(withAttributes.map(t => [t.name, t['attribute-references']])).toEqual([['Buyer', ['purchasingGroup']]])
  })
})

describe('mta.yaml', () => {
  const resource = name => mta.resources.find(r => r.name === name)
  const module = name => mta.modules.find(m => m.name === name)

  test('CAP service, HDI deployer and App Router; XSUAA, HDI container and Destination service', () => {
    expect(mta.modules.map(m => m.type).sort()).toEqual(['approuter.nodejs', 'hdb', 'nodejs'])
    expect(resource('invoice-workbench-auth').parameters).toMatchObject({ service: 'xsuaa', 'service-plan': 'application', path: './xs-security.json' })
    expect(resource('invoice-workbench-db').parameters).toMatchObject({ service: 'hana', 'service-plan': 'hdi-shared' })
    expect(resource('invoice-workbench-destination').parameters).toMatchObject({ service: 'destination', 'service-plan': 'lite' })
    expect(module('invoice-workbench-srv').requires.map(r => r.name).sort())
      .toEqual(['invoice-workbench-auth', 'invoice-workbench-db', 'invoice-workbench-destination'])
  })

  test('the App Router forwards the login token to the CAP service', () => {
    const srvApi = module('invoice-workbench').requires.find(r => r.name === 'srv-api')
    expect(srvApi).toMatchObject({ group: 'destinations', properties: { name: 'srv-api', forwardAuthToken: true } })
  })

  test('declared role collections: AP_Clerk and AP_Manager - never a Buyer without a purchasing group', () => {
    const collections = resource('invoice-workbench-auth').parameters.config['role-collections']
    expect(collections.map(c => [c.name.split(' ')[0], c['role-template-references']])).toEqual([
      ['AP_Clerk', ['$XSAPPNAME.APClerk']], ['AP_Manager', ['$XSAPPNAME.APManager']]])
  })

  test('build: production CAP build and the UI copy for the App Router; local-only files stay out', () => {
    const commands = mta['build-parameters']['before-all'][0].commands
    expect(commands).toEqual(['npm ci', 'npx cds build --production', 'node scripts/build-approuter-ui.js'])
    expect(module('invoice-workbench')['build-parameters'].ignore).toContain('default-env.json')
  })
})

describe('App Router (xs-app.json)', () => {
  test('every route requires an XSUAA login; only /odata goes to the CAP service, with CSRF protection', () => {
    for (const route of xsApp.routes) expect(route.authenticationType).toBe('xsuaa')
    const toService = xsApp.routes.filter(r => r.destination)
    expect(toService).toEqual([expect.objectContaining({ source: '^/odata/(.*)$', destination: 'srv-api', csrfProtection: true })])
    expect(xsApp.routes.filter(r => r.localDir).map(r => r.localDir)).toEqual(['resources'])
    expect(xsApp.authenticationMethod).toBe('route')
  })
})

describe('effective production configuration', () => {
  let requires
  beforeAll(() => { requires = productionEnv('requires') }, 60000)

  test('XSUAA authentication, no mocked users; SAP HANA Cloud', () => {
    expect(requires.auth.kind).toBe('xsuaa')
    expect(requires.auth.users).toBeUndefined()
    expect(requires.db.kind).toBe('hana')
  })

  test('the S/4 adapter over BTP destinations with a 5 s request timeout - no mock, no mock data', () => {
    expect(requires.ExternalPurchaseOrderService).toEqual({ model: 'srv/external/purchase-order-facade', timeout: 5000, impl: 'srv/external/s4-adapter.js' })
    expect(requires.API_PURCHASEORDER_2).toMatchObject({ kind: 'odata', credentials: { destination: 'S4HANA_PURCHASEORDER_2', requestTimeout: 5000 } })
    expect(requires.API_MATERIAL_DOCUMENT).toMatchObject({ kind: 'odata-v2', credentials: { destination: 'S4HANA_MATERIAL_DOCUMENT', requestTimeout: 5000 } })
    expect(requires.API_BUSINESS_PARTNER).toMatchObject({ kind: 'odata-v2', credentials: { destination: 'S4HANA_BUSINESS_PARTNER', requestTimeout: 5000 } })
    for (const sap of ['API_PURCHASEORDER_2', 'API_MATERIAL_DOCUMENT', 'API_BUSINESS_PARTNER'])
      expect(JSON.stringify(requires[sap].credentials)).not.toMatch(/url|password|user|apikey|secret|token/i)
    expect(requires.s4mock).toBeUndefined()
    expect(requires.s4api).toBeUndefined()
    expect(requires.destinations).toMatchObject({ vcap: { label: 'destination' } })
  })

  test('CAP\'s raw remote error log (SAP response bodies, URLs) is off; the sanitized facade log stays', () => {
    expect(productionEnv('log').levels).toMatchObject({ remote: 'error' })
  }, 60000)
})

describe('repository hygiene', () => {
  test('no credentials or local databases are tracked by git', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    expect(tracked.filter(f => /\.(sqlite|db|mtar)$|(^|\/)\.env$|default-env\.json$|\.cdsrc-private\.json$/.test(f))).toEqual([])
  })

  test('SAP API specifications, the models generated from them and the local mock data are never tracked (docs/sap-api-setup.md)', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    expect(tracked.filter(f => /^srv\/external\/specs\/.*\.(edmx|xml|json)$|^srv\/external\/s4\/|^mock-data\/s4api\/data\//.test(f))).toEqual([])
    const ignored = file => { try { execFileSync('git', ['check-ignore', '-q', file], { cwd: ROOT }); return true } catch { return false } }
    expect(['srv/external/specs/API_PURCHASEORDER_2.edmx', 'srv/external/s4/API_PURCHASEORDER_2.cds',
      'mock-data/s4api/data/API_PURCHASEORDER_2-PurchaseOrder.csv'].map(ignored)).toEqual([true, true, true])
  })
})
