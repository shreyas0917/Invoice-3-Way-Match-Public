// Whether the SAP API models are present. They are generated locally from SAP's API
// specifications, which each user obtains with their own SAP account (docs/sap-api-setup.md);
// this repository does not contain them. Only tests that run the S/4 adapter against those
// models (profile s4-adapter) depend on this - everything else runs without them.
const fs = require('fs')
const path = require('path')

const MODELS = ['API_PURCHASEORDER_2', 'API_MATERIAL_DOCUMENT', 'API_BUSINESS_PARTNER']
  .map(name => path.join(__dirname, '../../srv/external/s4', `${name}.cds`))
const missing = MODELS.filter(file => !fs.existsSync(file)).map(file => path.relative(path.join(__dirname, '../..'), file))

const available = missing.length === 0
const reason = available ? '' : `SKIPPED - SAP API models missing (${missing.join(', ')}); see docs/sap-api-setup.md`

// The local mock data (mock-data/s4api/data, git-ignored) is generated from fixtures.js and the
// imported models. With the models present but the data not generated yet, generate it once.
if (available) {
  const data = path.join(__dirname, '../../mock-data/s4api/data')
  const expected = Object.keys(require('../../mock-data/s4api/fixtures')).map(name => path.join(data, `${name.replace('.', '-')}.csv`))
  if (expected.some(file => !fs.existsSync(file))) {
    console.log('Generating the local SAP mock data (npm run s4:fixtures) ...')
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, '../../scripts/generate-s4-fixtures.js')], { stdio: 'inherit' })
  }
}

/** `describe` when the models exist, otherwise `describe.skip` with the reason in the title. */
const describeWithSapModels = (title, fn) => available ? describe(title, fn) : describe.skip(`${title} [${reason}]`, fn)

module.exports = { available, missing, reason, describeWithSapModels }
