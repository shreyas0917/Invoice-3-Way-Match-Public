# Release checklist (public repository)

The release gates, in order. Results and links: `docs/release-notes.md`; details:
`docs/public-release-audit.md`.

## Content
- [x] No SAP API specifications, generated models or schema-reproducing mock CSVs - git-ignored, guarded by a test
- [x] `mock-data/s4api/fixtures.js`: synthetic values, only the 31 fields the adapter reads
- [x] `docs/sap-api-setup.md` explains how users obtain the SAP files themselves
- [x] MIT License for original material; `NOTICE.md` for SAP materials, SAPUI5, dependencies, trademarks
- [x] No personal email, local paths or personal data; screenshots show the local app with MOCK data
- [x] No build output, local databases or `.env` files

## Quality
- [x] Clean install from the lockfile (`npm ci`)
- [x] Without SAP files: `cds compile srv`, `cds build` OK; tests 388 - 358 passed, 30 skipped (only the two adapter suites), 0 failed
- [x] With SAP files (throwaway copy): tests 388 / 388; `cds build --production` and `mbt build` OK
- [x] Production build without SAP files fails clearly and points to the setup guide
- [x] Mermaid 7 / 7 render; internal links resolve
- [x] CI: read-only `permissions`, actions pinned to commit SHAs, no secrets

## Claims
- [x] "Deployment configuration included; deployment and live SAP service connectivity not yet verified"
- [x] No claim of HANA persistence, real XSUAA login, live S/4HANA or resolved SAP licensing

## Publication gates
- [ ] Gitleaks on all files and on the full Git history after the first commit
- [ ] First commit with the noreply identity; independent history (no link to the private repository)
- [ ] GitHub repository created **private**; push; CI green on the pushed commit
- [ ] README, links and diagrams checked on GitHub; no SAP files in the remote tree
- [ ] Visibility -> public only if every gate above passed
- [ ] Branch protection on `main`; secret scanning and push protection (where the plan allows)
