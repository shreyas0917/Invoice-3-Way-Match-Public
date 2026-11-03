# Public release audit

This repository is the **public version** of the project (fresh Git history, 2026-11-03). The
private development repository (`Invoice-3-Way-Match`) stays private and unchanged. Part A records
the remediation and release checks; part B is the original audit of the private repository.

# Part A - Remediation and release results (this repository)

SAP licensing is **not resolved** - it is avoided: no SAP specification, no model generated from it
and no CSV reproducing its schema is included.

| Audit item | Result |
|---|---|
| R1 SAP files (blocking) | **Fixed by exclusion.** The 3 EDMX specifications and the 3 `cds import` models are not in the repository and are git-ignored; `docs/sap-api-setup.md` explains how users obtain them. A test fails if they are ever tracked. |
| R1b SAP-shaped mock CSVs | **Reduced.** `mock-data/s4api/fixtures.js` now lists only the 31 fields the adapter reads (3 supplier, 7 PO header, 11 PO item, 10 material document; keys included) with synthetic values. The CSVs - whose 61 / 161 columns were every non-nullable column of SAP's PO model - are no longer committed; `npm run s4:fixtures` generates them locally from the user's own models (git-ignored). The unused material-document header fixture was removed. Verified: all 348 adapter-read values identical to before; 388 / 388 tests with the SAP files. |
| R2 broken Mermaid diagram | **Fixed** (`;` -> `,`, architecture overview). 7 / 7 diagrams render. |
| R3 personal email in commits | **Fixed:** fresh history; Git identity is the GitHub noreply address. |
| R4 wording | **Fixed:** deployment status worded as "BTP deployment configuration included; deployment and live SAP service connectivity not yet verified"; stale statements updated. |
| R5 CI | **Fixed:** `permissions: contents: read`; `actions/checkout` and `actions/setup-node` pinned to commit SHAs (v4.4.0); no secrets. |
| R7 license | **MIT** for original project material (`LICENSE`, copyright Shreyas Wani 2026); `NOTICE.md` excludes SAP materials, SAPUI5 (loaded from SAP's CDN, not included), screenshots' SAP Fiori design, SAP-licensed npm dependencies and trademarks. |

## Release checks (before the first commit, 2026-11-03)

| Check | Result |
|---|---|
| Clean install (`node_modules` deleted, `npm ci` from the lockfile) | OK (430 packages added) |
| `cds compile srv` (CI step), `cds build` - without SAP files | OK |
| `npm test` **without** SAP files | **388 tests: 358 passed, 30 skipped, 0 failed**; 24 suites (22 passed, 2 skipped). Skipped: `facade-contract.s4-adapter.test.js` (23), `s4-adapter-remote.test.js` (7), each with `[SKIPPED - SAP API models missing (...); see docs/sap-api-setup.md]` in the title |
| `cds build --production` without SAP files | fails as designed: `Can't find local module './s4/...'` in `srv/external/s4-apis.cds`, whose header points to `docs/sap-api-setup.md` |
| With SAP files (throwaway copy following `docs/sap-api-setup.md`, deleted afterwards) | `npm test` **388 / 388 passed**; `cds build --production` OK; `mbt build` OK (`invoice-workbench_0.1.0.mtar`, 9.0 MB, no SAP or mock-data files inside) |
| Mermaid / internal links | 7 / 7 render; all internal links resolve |
| `npm audit` | **production dependencies: 0 vulnerabilities.** Dev only: 21 (3 low, 16 moderate, 2 high). The high ones: `body-parser@2.3.0` (GHSA-27r3-jxmh-p828, DoS) **bundled inside `@sap/cds-dk@10.2.0`** (latest release) - not overridable with npm `overrides`; npm's only "fix" is a major downgrade to cds-dk 9, which would break the CAP 10 toolchain. Affects local development tooling only; the runtime uses `@sap/cds` -> `express` -> `body-parser@2.4.0` (fixed). Accepted until SAP ships a cds-dk update. |

Gitleaks, commit, CI and publication results are recorded in `docs/release-notes.md`.

## Remaining limitations

1. SAP licensing is avoided, not resolved; the adapter still uses field names of the public SAP APIs
   to interoperate with them (see `NOTICE.md`).
2. BTP deployment, real XSUAA login, HANA persistence and live S/4HANA connectivity are unverified.
3. Dev-only `body-parser` advisory inside `@sap/cds-dk` (above).
4. The public history starts fresh; the phase-by-phase history stays in the private repository.

---

# Part B - Original audit of the private repository

- Repository: https://github.com/shreyas0917/Invoice-3-Way-Match (private)
- Audited: 2026-11-03, `main` = `87d13d6`, all branches and tags
- Scope: secrets, SAP licensing, security, documentation, CI. Audit only - nothing was changed,
  committed or pushed; this report is the only new file (uncommitted).

### Verdict: **READY AFTER REQUIRED FIXES**

No secrets were found in the full history, and the application content is safe to show. Publishing
is blocked by one unresolved item: **the SAP API definition files (and files generated from them)
have no verified redistribution right**. Two small documentation fixes are also required.

---

### 1. Git and branch inventory

| Item | Finding |
|---|---|
| Commits | 14, linear history, one author |
| `main` | `87d13d6` = `feature/phase-11-btp-deployment` (the finished project) |
| Feature branches | 10, local and remote identical: `feature/phase-2-invoice-workbench` `d942729`, `-3-validation` `8cc5283`, `-4-matching-engine` `4ca7681`, `-5-status-audit` `421e75a`, `-6-security` `ae453d0`, `-7-fiori-apps` `5c8c97f`, `-8-integration-hardening` `f385841`, `-10-s4-api-adapter` `325ac34`, `-11-btp-deployment` `87d13d6` (there is no phase 9 branch; phase 9 was skipped) |
| Tags | `phase-0` `50f13d6`, `phase-1` `5fb3d5a`, `phase-2` `d942729`; no tags for phases 3-11 |
| Tracked files | 159; binaries are only the 7 screenshots |
| Untracked | none. Ignored and present locally: `gen/`, `mta_archives/`, `node_modules/`, `.deploy/app-router/{default-env.json,node_modules,resources}` |
| `.gitignore` | covers build output, `.env`, `default-*.json`, `.cdsrc-private.json`, `*.sqlite`, `*.db`, `*.mtar`, `mta_archives/` |

### 2. Secret scan

| Check | Result |
|---|---|
| Gitleaks 8.30.1, `gitleaks git --log-opts=--all --redact` | **14 commits, 2.26 MB, no leaks found** (all branches and tags) |
| Supplementary scan of every added line in history (private keys, JWTs, GitHub/AWS/OpenAI-style tokens, `password`/`clientsecret`/`apikey` with values) | none |
| Hosts in URLs | public registries and docs (npmjs, oasis-open, github, ui5.sap.com, w3.org ...), `localhost`, test placeholders `s4.example.com`, `example.invalid` |
| IP addresses | only `127.0.0.1` |
| Ignored local file `.deploy/app-router/default-env.json` | Gitleaks: no leaks; contains only `http://localhost:4004` |
| Deployment files (`mta.yaml`, `xs-security.json`, `xs-app.json`, `package.json`) | no credentials; credentials come from bindings/destinations by design |

Harmless by design (not secrets): mocked test users with empty passwords (development/test
profiles only), the string `not-a-secret` used in local checks (not committed), `example.invalid`
URLs and the `Secret1` / `token=abc` strings in tests that prove sanitizing.

**No genuine secret was found; no rotation is needed.**

### 3. SAP licensing

#### Affected files

| Files | Nature | Risk |
|---|---|---|
| `srv/external/specs/API_PURCHASEORDER_2.edmx`, `API_MATERIAL_DOCUMENT.edmx`, `API_BUSINESS_PARTNER.edmx` (about 900 KB) | SAP's API definitions, byte-for-byte as downloaded (login required) | **High - requires legal review** |
| `srv/external/s4/*.cds` (3 files) | generated by `cds import` from those files; full entity/field definitions and SAP's annotation texts | **High - derived work, same review** |
| `mock-data/s4api/data/*.csv`, `mock-data/s4api/fixtures.js` | own MOCK values; column names follow the SAP schema | Low |
| `srv/external/s4-adapter.js`, tests | SAP field names used to interoperate with the API | Low |

They exist in commit `325ac34` and every later commit, i.e. in `main`,
`feature/phase-10-s4-api-adapter` and `feature/phase-11-btp-deployment`. Earlier branches do not
contain them.

#### Evidence available

- **In the repository:** no license, copyright or terms text in the EDMX files; no LICENSE/NOTICE
  file. `srv/external/specs/README.md` records source, versions, download time and SHA-256, and
  says the files are "subject to [the Hub's] terms" - it does not state what those terms allow.
- **Downloading** requires an SAP login (verified in phase 10: the download URL redirected to SAP's
  login page).
- **SAP's Terms of Use** for the SAP Business Accelerator Hub
  ([help.sap.com, Terms of Use](https://help.sap.com/docs/business-accelerator-hub/terms-of-use/terms-of-use-for-sap-business-accelerator-hub))
  could **not be read** in this audit (the page renders only in a browser). Search excerpts of the
  terms indicate that use of "API Information" is governed by your license agreement with SAP if
  you have one, and otherwise limited to internal, non-productive, non-commercial test and
  evaluation purposes. **This is unverified** - the excerpt was partly garbled and could not be
  checked against the live text.

#### Conclusion

**Not verified that public redistribution is permitted.** The project owner has no SAP license
agreement on record for this project, and the excerpt above, if accurate, would not cover publishing
the files to everyone. Treat the affected files as **requiring legal review** before the repository
becomes public. They are not deleted by this audit.

#### Safe publication alternative

Publish without the SAP files and let users obtain them:
1. Keep `srv/external/specs/README.md` (provenance, versions, checksums) as instructions: download
   the three EDMX files with your own SAP account from the Hub, then run the documented
   `cds import` commands (and `npm run s4:fixtures`).
2. The default application (mock) and its tests do not need the SAP files. The adapter-related tests
   and the `s4-adapter` profile do; they would need to skip with a clear message when the imported
   models are missing (code change - not done in this audit).
3. Because the files are in the history of three branches, removing them from the current tree is
   not enough: either publish a **new public repository** with fresh history (recommended - no
   rewrite of this one), or rewrite this repository's history (destructive; needs approval).

### 4. Security review

| Check | Result |
|---|---|
| Hardcoded credentials | none found (section 2) |
| Personal information in files | none: no names, phone numbers, addresses, employer references or local paths in tracked files or history |
| **Commit author email** | every commit carries the author's personal Gmail address in its metadata; it becomes public with the repository. Low risk, but cannot be removed without rewriting history |
| Screenshots (7) | MOCK supplier names, mocked users (`clerk1`), random UUIDs; no browser address bar; **no PNG metadata chunks** (no text/EXIF); captions accurate |
| Local database files | none tracked (`*.sqlite`, `*.db` ignored; enforced by a test) |
| Mock and test data | fictional (`MOCK ...` suppliers, `TEST ...`/`MAT-...` materials); the SAP-shaped CSVs' address, phone, tax and person columns are all empty |
| Environment variables | `.env` ignored; `.env.example` contains comments and placeholders only |
| Deployment artefacts | `mta_archives/` and `gen/` ignored; `.deploy/app-router` tracks only `package.json`, `package-lock.json`, `xs-app.json` |
| GitHub Actions | triggers `push` and `pull_request` (not `pull_request_target`); repository default token permission is **read**; no secrets used. No explicit `permissions:` block (relies on the repository default); actions pinned to major tags, not commit SHAs |
| Branch protection / rulesets | **not available** on a private repository of the current plan (API: "upgrade or make public"); none configured |
| GitHub secret scanning | not enabled (not offered for this private repository) |
| Generated files | none tracked except the lock files and the `cds import` output (section 3) |

### 5. Documentation

| Check | Result |
|---|---|
| Relative links (README, `docs/`, ADRs, specs and mock-data READMEs) | 10 checked, **0 broken** |
| File paths named in docs | all exist |
| Mermaid diagrams | 7 parsed and rendered with Mermaid 11.4.1 in headless Chrome: **6 OK, 1 broken** - `docs/architecture-overview.md`, match sequence diagram starting at line 142; the offending line is 163. Cause: `;` in "insert MatchResults, Exceptions; update item match status" ends the statement. Replacing `;` with `,` was confirmed to fix it (tested on a copy) |
| Claims: BTP deployment, HANA persistence, XSUAA login, live S/4HANA | **not claimed** anywhere; consistently "configured / built / not verified" |
| Overstatement | `docs/demo-script.md` line 59: "as deployed in phase 11" - should say "as configured in phase 11 (not deployed)" |
| Stale since the push (understatements) | `README.md` line 83 ("no run of this branch has been observed - it has not been pushed"); `docs/portfolio-checklist.md` lines 16, 31, 50-51 (branches not pushed, CI not observed, Mermaid not checked) |
| Test claims | "387 tests" matches the green CI run on `main` |

### 6. CI status

| Ref | Latest run (commit) | Result |
|---|---|---|
| `main` | `87d13d6` | **success** (387/387) |
| all 10 feature branches | each on its current head commit | **success** |
| tag `phase-2` | `d942729` | success |
| tags `phase-0`, `phase-1` (2026-11-02) | `50f13d6`, `5fb3d5a` | **failure** - the skeleton commits had no `srv` model, so the workflow's `cds compile srv` step fails. Historical, expected for those snapshots; not a regression |
| superseded | `main` and `feature/phase-11` at `f51a014` | failure (3 deployment-config tests, CLI output format on Linux) - fixed in `87d13d6` |

Branch protection: not configured (not available on this plan while private).

### 7. Critical and high-priority risks

| # | Severity | Risk |
|---|---|---|
| R1 | **High (blocking)** | SAP API definitions and their `cds import` output published without verified redistribution rights (section 3) |
| R2 | Medium | Broken Mermaid diagram in the architecture overview (visible error on GitHub) |
| R3 | Low | Commit metadata exposes a personal email address |
| R4 | Low | Wording: one overstatement (demo script) and stale "not pushed / not observed" statements |
| R5 | Low | Workflow without explicit least-privilege `permissions:`; actions not SHA-pinned; no branch protection or secret-scanning push protection yet |
| R6 | Info | Red CI history on tags `phase-0`/`phase-1` |
| R7 | Info | No `LICENSE` file: public but "all rights reserved" (`UNLICENSED`); intentional per README, but visitors may not reuse the code |

No critical risk (no secret, no personal data in content).

### 8. Recommended remediation

**Required before publishing**
1. **R1 SAP files** - choose one:
   - (a) Get the redistribution question answered (SAP terms read in full, or legal advice); publish
     as-is only with written confirmation; or
   - (b) **Recommended:** publish a **new public repository** created from a clean snapshot that
     excludes `srv/external/specs/*.edmx` and `srv/external/s4/*.cds`, with download/import
     instructions and adapter tests that skip when the models are absent. This repository stays
     private with its full history. No history rewrite needed.
2. **R2** - in `docs/architecture-overview.md`, change "Exceptions; update item" to "Exceptions,
   update item".
3. **R4** - fix the demo-script sentence and the stale README/checklist statements.

**Recommended**
4. **R3** - commit with the GitHub `noreply` address from now on (Settings -> Emails -> keep my email
   private); a fresh public repository (1b) can use it from its first commit.
5. **R5** - add `permissions: contents: read` to the workflow; after publishing, enable branch
   protection on `main`, secret scanning and push protection.
6. **R6/R7** - optionally note in the README that tags `phase-0`/`phase-1` predate the model; decide
   on a `LICENSE` (keep all rights reserved, or e.g. MIT for your own code - never for SAP's files).

### 9. Public-release decision

**READY AFTER REQUIRED FIXES.** Safe from a secrets and privacy-in-content perspective; publish
only after R1 is resolved (preferably option 1b) and R2/R4 are fixed. No remediation has been
performed - waiting for approval.
