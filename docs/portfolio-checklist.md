# GitHub portfolio checklist

State on 2026-11-03. This is the **public repository** (fresh history, prepared from the private
development repository `Invoice-3-Way-Match`, which stays private and unchanged). `[x]` = done and checked, `[ ]` = open.

## Repository cleanliness

- [x] Working tree clean after each phase commit; no build output tracked (`gen/`, `mta_archives/`,
      `.deploy/app-router/resources/`, `node_modules/` are git-ignored).
- [x] No local databases tracked (`*.sqlite`, `*.db` ignored; checked by a test in
      `test/unit/deployment-config.test.js`).
- [x] Private development repository: `main` = finished project; all 10 feature branches pushed;
      tags `phase-0` to `phase-2`.
- [x] Public repository https://github.com/shreyas0917/Invoice-3-Way-Match-Public: fresh history
      (release commit `fe019f1`), public, branch protection on `main`.

## README quality

- [x] Overview, business problem, capabilities, screenshots, architecture, stack, tests, demo,
      local setup, deployment readiness, license note.
- [x] Honest status at the top: local and tested; adapter tested against mocks only; BTP not deployed.
- [x] What is real versus mock is listed explicitly.

## Architecture diagrams

- [x] Mermaid diagrams in `docs/architecture-overview.md` (components, data model, lifecycle,
      match sequence, integration, local vs BTP) and a summary diagram in the README.
- [x] All Mermaid diagrams parse and render with Mermaid 11 (checked in headless Chrome).
- [x] Rendered on github.com after publishing (anonymous browser check).

## Screenshots

- [x] Seven real screenshots of the local app (headless Chrome, MOCK data) in `docs/screenshots/`.
- [ ] Screenshots of the deployed BTP app - none, because it is not deployed.
- [ ] Optional: a screenshot of the launch page and of an invoice in status Released.

## Demo recording

- [ ] **No recording exists.** Record the local demo (`docs/demo-script.md`, about 10 minutes, or a
      3-minute cut) with a screen recorder; say in the video that S/4 data is MOCK.
- [ ] Blueprint completion criterion for phase 11: a recording of the **deployed** app - open.

## Test evidence

- [x] `npm test` in this repository: 388 tests, 24 suites - without the SAP API files 358 passed and
      30 skipped; with them 388 / 388 passed (2026-11-03).
- [x] Coverage measured in phase 8/10 (matching engine 100 % lines, 97.8 % branches;
      `s4-adapter.js` 99 % lines) - re-run `npx jest --coverage` before quoting numbers.
- [x] CI in the private repository: `main` and all 10 feature branches passed (387/387 on `main`).
- [x] CI in the public repository: green on `fe019f1` (358 passed, 30 skipped); read-only `permissions`,
      actions pinned to commit SHAs.

## Environment setup

- [x] `npm install`, `npm run watch`, `npm test` documented; Node.js 20+ (`engines`), developed on 24.
- [x] `.env.example` lists optional local settings without secrets.
- [ ] Try a fresh clone on another machine (or a GitHub Codespace) and follow the README exactly.

## Secret scanning

- [x] Manual scan of the phase 11 diff: no credentials, tokens or keys; `.env`, `default-*.json`,
      `.cdsrc-private.json` are git-ignored.
- [ ] Run an automated scanner over the whole history before making the repository public, for
      example GitHub secret scanning or `gitleaks detect` (not run).
- [x] Test users have empty passwords by design (mocked authentication, development/test only).

## License considerations

- [x] MIT License for the original project material (`LICENSE`); `NOTICE.md` excludes SAP materials,
      SAPUI5, dependencies and trademarks.
- [x] SAP API definitions and the models generated from them are **not included** (git-ignored);
      `docs/sap-api-setup.md` explains how users obtain them. SAP's licensing terms were **not**
      verified - nothing in this repository claims a right to redistribute SAP files.

## Accurate project claims

Use these sentences - and avoid the ones on the right.

| Say | Do not say |
|---|---|
| "Built against the official SAP S/4HANA API definitions; tested with local mocks." | "Integrated with S/4HANA." |
| "Deployment to SAP BTP is prepared; the MTA archive builds." | "Deployed on SAP BTP." |
| "XSUAA roles and HANA are configured, not yet verified." | "Uses HANA Cloud and XSUAA in production." |
| "388 automated tests; the adapter suites need SAP's API files." | "Production-ready." |
| "Concurrency tested with parallel requests on SQLite." | "Load-tested." |

- [x] README, ADRs and demo script follow this wording.
- [ ] Update every claim once BTP deployment or S/4 connectivity is actually verified.
