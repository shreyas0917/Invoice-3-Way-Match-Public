#!/usr/bin/env node
/**
 * Writes mock-data/s4api/data/*.csv from mock-data/s4api/fixtures.js, using the imported SAP
 * API models (srv/external/s4) to fill every non-nullable column the fixture does not set with
 * SAP's empty value ('' for text, 0 for numbers, false for flags). Unknown fields are an error,
 * so a fixture can only use fields the official API definitions really have.
 *
 *   node scripts/generate-s4-fixtures.js
 */
const cds = require('@sap/cds')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'mock-data/s4api/data')
const fixtures = require(path.join(ROOT, 'mock-data/s4api/fixtures.js'))

const EMPTY = { 'cds.String': '', 'cds.LargeString': '', 'cds.Boolean': false, 'cds.Decimal': 0, 'cds.Integer': 0,
  'cds.Int16': 0, 'cds.Int32': 0, 'cds.Int64': 0, 'cds.Double': 0, 'cds.UInt8': 0 }

const cell = value => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"` // quoted: kept as text, '' stays ''
  if (Array.isArray(value)) return `"${JSON.stringify(value).replace(/"/g, '""')}"`
  return String(value)
}

const MISSING = ['API_PURCHASEORDER_2', 'API_MATERIAL_DOCUMENT', 'API_BUSINESS_PARTNER']
  .filter(name => !fs.existsSync(path.join(ROOT, 'srv/external/s4', name + '.cds')))
if (MISSING.length) {
  console.error(`SAP API models missing in srv/external/s4: ${MISSING.join(', ')} - see docs/sap-api-setup.md`)
  process.exit(1)
}

;(async () => {
  const model = cds.linked(await cds.load(['API_PURCHASEORDER_2', 'API_MATERIAL_DOCUMENT', 'API_BUSINESS_PARTNER']
    .map(name => path.join(ROOT, 'srv/external/s4', name))))
  fs.rmSync(OUT, { recursive: true, force: true }) // generated output only (git-ignored)
  fs.mkdirSync(OUT, { recursive: true })
  for (const [entityName, rows] of Object.entries(fixtures)) {
    const entity = model.definitions[entityName]
    if (!entity) throw new Error(`${entityName} is not in the imported SAP models`)
    const columns = Object.values(entity.elements).filter(e => !e.isAssociation && !e.virtual)
    const known = new Set(columns.map(c => c.name))
    for (const row of rows) for (const field of Object.keys(row))
      if (!known.has(field)) throw new Error(`${entityName}.${field} does not exist in the official API definition`)
    // columns: everything the fixtures set, plus every non-nullable column
    const used = columns.filter(c => rows.some(r => c.name in r) || c.notNull)
    const lines = [used.map(c => c.name).join(';')]
    for (const row of rows) lines.push(used.map(c => {
      if (c.name in row) return cell(row[c.name])
      if (c.items) return cell([]) // e.g. SAP__Messages : many SAP__Message
      if (!c.notNull) return ''
      if (!(c.type in EMPTY)) throw new Error(`${entityName}.${c.name}: no empty value for type ${c.type}`)
      return cell(EMPTY[c.type])
    }).join(';'))
    const file = path.join(OUT, `${entityName.replace('.', '-')}.csv`)
    fs.writeFileSync(file, lines.join('\n') + '\n')
    console.log(`${path.relative(ROOT, file)}: ${rows.length} rows, ${used.length} columns`)
  }
})().catch(error => { console.error(error.message); process.exit(1) })
