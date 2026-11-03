# SAP API specifications - local setup

The optional S/4HANA adapter (`srv/external/s4-adapter.js`) is built against three official SAP
API specifications. **This repository does not contain them**, nor the CDS models generated from
them. It does not provide, license or redistribute any SAP file. To use the adapter you obtain the
specifications yourself, through your own authorised SAP account and under the terms that apply to
you (see the SAP Business Accelerator Hub Terms of Use).

Everything else - the application with its MOCK S/4 data, the five Fiori apps and almost all tests -
runs without them.

## What you need

| Save as | SAP API (SAP S/4HANA) | Protocol | Version this project was built with |
|---|---|---|---|
| `srv/external/specs/API_PURCHASEORDER_2.edmx` | Purchase Order, `API_PURCHASEORDER_2` | OData V4 | 1.3.0 |
| `srv/external/specs/API_MATERIAL_DOCUMENT.edmx` | Material Documents, `API_MATERIAL_DOCUMENT_SRV` | OData V2 | 1.3.0 |
| `srv/external/specs/API_BUSINESS_PARTNER.edmx` | Business Partner, `API_BUSINESS_PARTNER` | OData V2 | 1.6.0 |

1. Sign in to the SAP Business Accelerator Hub (https://api.sap.com) with your SAP account, open
   each API (product SAP S/4HANA), and download **API Specification -> EDMX**. The Hub may offer a
   different file name (for example `OP_PURCHASEORDER_0001.edmx`); save it under the name above.
2. Optional check: `srv/external/specs/README.md` lists the schema versions and SHA-256 checksums of
   the files this project was developed with. Other versions may work but are untested.
3. Generate the CDS models with cds-dk (a dev dependency - run `npm install` first):

   ```sh
   npx cds import srv/external/specs/API_PURCHASEORDER_2.edmx   --out srv/external/s4/ --as cds --no-save
   npx cds import srv/external/specs/API_MATERIAL_DOCUMENT.edmx --out srv/external/s4/ --as cds --no-save
   npx cds import srv/external/specs/API_BUSINESS_PARTNER.edmx  --out srv/external/s4/ --as cds --no-save
   ```

   This creates `srv/external/s4/API_PURCHASEORDER_2.cds`, `API_MATERIAL_DOCUMENT.cds` and
   `API_BUSINESS_PARTNER.cds` (`cds import` also copies the `.edmx` files there). Do not edit them.

4. Generate the local synthetic mock data for CAP's mocks of the SAP APIs: `npm run s4:fixtures`.
   This writes `mock-data/s4api/data/*.csv` from `mock-data/s4api/fixtures.js` (only the fields the
   adapter reads) and your imported models (which define the remaining required columns). The
   adapter test suites and `npm run watch:s4` do this automatically when the data is missing.

All three folders are **git-ignored** (`srv/external/specs/*.edmx`, `srv/external/s4/`,
`mock-data/s4api/data/`), so the files cannot be committed by accident. Do not commit or publish them.

## Running the tests

```sh
npm test
```

| | Without the SAP files | With the SAP files |
|---|---|---|
| Default app, unit, service and facade tests (mock) | run | run |
| `test/unit/s4-adapter-mapping.test.js` (adapter mapping rules, configuration checks) | run - needs no SAP model | run |
| `test/integration/facade-contract.s4-adapter.test.js` - the facade contract against the adapter over CAP's local mocks of the SAP APIs, adapter edge cases, end-to-end match | **skipped** (23 tests) | run |
| `test/integration/s4-adapter-remote.test.js` - the adapter through CAP's OData V2/V4 clients against a fake SAP server on localhost | **skipped** (7 tests) | run |

Skipped suites say why in their title: `[SKIPPED - SAP API models missing (...); see docs/sap-api-setup.md]`.
The check is `test/integration/sap-api-models.js`: it looks only for the three generated `.cds`
files. No other test is ever skipped.

## What else needs the SAP files

- `npm run watch:s4` (the adapter with CAP's local mocks of the SAP APIs).
- `npm run s4:fixtures` (generates the local synthetic mock data, step 4).
- The **production** profile and therefore `cds build --production` and `mbt build`: production uses
  the adapter. Without the models they stop with `Can't find local module './s4/...'`.

Not needed for: `npm run watch` (mock), `npm test` (minus the two suites above), `cds compile srv`.

## Scope reminder

The adapter has been tested only against local mocks and a fake SAP server. No real S/4HANA system
(or SAP sandbox) has been called, and the SAP BTP deployment has not been executed.
