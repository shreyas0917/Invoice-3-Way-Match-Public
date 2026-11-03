#!/usr/bin/env node
/**
 * Copies the Fiori apps into the App Router (.deploy/app-router/resources) for the MTA build.
 * On BTP the App Router serves them (CAP's production build contains no app files) and forwards
 * /odata/... to the CAP service. Paths stay as locally: /index.html, /<app>/webapp/index.html.
 * Only static UI files are copied - no .cds annotation sources (they are compiled into the service).
 *
 *   node scripts/build-approuter-ui.js        (run by mta.yaml before the modules are built)
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const APP = path.join(ROOT, 'app')
const OUT = path.join(ROOT, '.deploy/app-router/resources')

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(APP, 'index.html'), path.join(OUT, 'index.html'))

const apps = fs.readdirSync(APP, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(APP, entry.name, 'webapp', 'manifest.json')))
  .map(entry => entry.name)
for (const app of apps)
  fs.cpSync(path.join(APP, app, 'webapp'), path.join(OUT, app, 'webapp'), { recursive: true })

console.log(`App Router resources: index.html + ${apps.length} apps (${apps.join(', ')})`)
