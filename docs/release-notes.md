# Release notes - 0.1.0 (first public release, 2026-11-03)

Repository: https://github.com/shreyas0917/Invoice-3-Way-Match-Public (public)
Release commit: `fe019f108394563ac0656e79f342e3e6aaf8a1ef` - "feat: release SAP invoice three-way matching workbench"
License: MIT for original project material; SAP materials excluded (see `NOTICE.md`).

## Overview

An SAP CAP (Node.js) and SAP Fiori elements application for accounts payable. It checks supplier
invoices against purchase orders and goods receipts (three-way match) within configurable
tolerances, routes every mismatch to the responsible buyer or AP manager, and keeps a complete
audit trail. Portfolio project, built phase by phase from a technical blueprint.

## Architecture summary

- One CAP Node.js application (modular monolith): InvoiceService, ExceptionService, AdminService
  (OData V4) for five Fiori elements apps; MatchingEngine and the S/4 facade as internal services.
- Pure business logic in `srv/lib`: matching engine, tolerances, exact decimal arithmetic (BigInt),
  duplicate rules, validation, status machine (one transition table, one writer, audit history).
- S/4HANA facade: one contract; a MOCK implementation (default) and an adapter for the official SAP
  APIs (Purchase Order OData V4, Material Document and Business Partner OData V2), behind a guard with
  5 s timeouts, sanitized errors and an Integration Log.
- Security: `@requires` / `@restrict`, purchasing-group isolation, segregation of duties.
- Local: SQLite and mocked users. Prepared for SAP BTP: HANA Cloud, XSUAA, App Router,
  destinations, MTA.

Details: `docs/architecture-overview.md`, `docs/technical-decisions.md`, `docs/adr/`.

## Test results

| Run | Tests | Passed | Skipped | Failed |
|---|---|---|---|---|
| GitHub Actions on `fe019f1` ([run 41681986172](https://github.com/shreyas0917/Invoice-3-Way-Match-Public/actions/runs/41681986172)) - no SAP files | 388 | 358 | 30 | 0 |
| Local, fresh `git clone` of `fe019f1`, `npm ci` - no SAP files | 388 | 358 | 30 | 0 |
| Local, with SAP files imported per `docs/sap-api-setup.md` (throwaway copy, deleted) | 388 | 388 | 0 | 0 |

The 30 skipped tests are exactly the two adapter suites that need the SAP API models
(`facade-contract.s4-adapter.test.js` 23, `s4-adapter-remote.test.js` 7); their titles state the reason.

## Build results

| Build | Without SAP files | With SAP files |
|---|---|---|
| `npm ci` (lockfile) | OK | OK |
| `cds compile srv`, `cds build` | OK | OK |
| `cds build --production` | fails by design: `Can't find local module './s4/...'` (points to the setup guide) | OK |
| `mbt build` | not possible (production needs the adapter models) | OK - 9.0 MB `.mtar`, no SAP or mock-data files inside |

## Security scan results

- Gitleaks 8.30.1: staged change set, all 154 committed files and the full Git history (1 commit) -
  **no leaks**.
- No personal email, local paths or personal data; commits use the GitHub noreply address.
- `npm audit`: **0 vulnerabilities in production dependencies**. Development only: 21 (3 low,
  16 moderate, 2 high) - the high ones are `body-parser@2.3.0` bundled inside `@sap/cds-dk@10.2.0`
  (GHSA-27r3-jxmh-p828), not fixable without SAP releasing a new cds-dk; the runtime uses
  `body-parser@2.4.0`.
- CI: `permissions: contents: read` (job token: Contents read, Metadata read), actions pinned to
  commit SHAs, no secrets.
- GitHub (after publishing): secret scanning and push protection enabled; Dependabot alerts enabled;
  branch protection on `main` (status check `test` required for merges, no force pushes, no deletion).

## SAP specification setup

The SAP API specifications are **not included**. To use the adapter, obtain them with your own SAP
account and run the imports and `npm run s4:fixtures` as described in `docs/sap-api-setup.md`.

## Deployment status (honest)

The project includes SAP BTP deployment configuration, but deployment and live SAP service
connectivity have not yet been verified. No real XSUAA login, no HANA persistence and no call to a
real S/4HANA system (or SAP sandbox) has been tested.

## Known limitations

- SAP licensing is avoided (nothing SAP-owned is included), not resolved; the adapter uses field
  names of the public SAP APIs to interoperate with them.
- BTP deployment, XSUAA login, HANA persistence and live S/4HANA connectivity are unverified.
- Dev-only `body-parser` advisory inside `@sap/cds-dk` (above).
- Supplier country is not mapped by the adapter; units of measure are passed through; very large
  POs are read without server-side paging (ADR 0008).
- The public history starts with this release; the phase-by-phase history is in a private repository.
