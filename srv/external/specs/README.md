# SAP API specifications (not included)

This folder is where **you** place SAP's API specifications to use the optional S/4HANA adapter.
**This repository does not contain them**: obtain them with your own authorised SAP account, under
the terms that apply to you. Setup and import: [`docs/sap-api-setup.md`](../../../docs/sap-api-setup.md).
`*.edmx` files here are git-ignored.

## Versions this project was developed with

For reference only - the files themselves are not distributed.

| Expected file | SAP API | Protocol | Schema version | Service namespace / container |
|---|---|---|---|---|
| `API_PURCHASEORDER_2.edmx` | Purchase Order (A2X) - `API_PURCHASEORDER_2` | OData V4 (EDMX 4.0) | 1.3.0 (`SAP__core.SchemaVersion`) | `com.sap.gateway.srvd_a2x.api_purchaseorder_2.v0001` / `Container` |
| `API_MATERIAL_DOCUMENT.edmx` | Material Documents - `API_MATERIAL_DOCUMENT_SRV` | OData V2 (EDMX 1.0, DataServiceVersion 2.0) | 1.3.0 (`Core.SchemaVersion`) | `API_MATERIAL_DOCUMENT_SRV` / `API_MATERIAL_DOCUMENT_SRV_Entities` |
| `API_BUSINESS_PARTNER.edmx` | Business Partner (A2X) - `API_BUSINESS_PARTNER` | OData V2 (EDMX 1.0, DataServiceVersion 2.0) | 1.6.0 (`Core.SchemaVersion`) | `API_BUSINESS_PARTNER` / `API_BUSINESS_PARTNER_Entities` |

SHA-256 of the files used during development (downloaded 2026-11-03, product SAP S/4HANA; the
Purchase Order file was offered as `OP_PURCHASEORDER_0001.edmx`). A different checksum usually just
means a newer version, which may need re-testing:

| File | SHA-256 |
|---|---|
| `API_PURCHASEORDER_2.edmx` | `91c66c2e0857b450c0621184be7ad5c5cd8f623d3f4e75bfe43c368a838b0671` |
| `API_MATERIAL_DOCUMENT.edmx` | `3bc448499d92cb2584341df31acae6d7955bc6b31d33c0903dedd9ef5a382944` |
| `API_BUSINESS_PARTNER.edmx` | `0fa767941ad2995805f9aad8f768a3e6dde77712f6057a962f3f3f2142a1ca64` |

The EDMX files do not state the product edition; "SAP S/4HANA" is the selection made on the Hub.

## Generated models

`cds import <file> --out srv/external/s4/ --as cds --no-save` (cds-dk 10.2.0) generates
`../s4/API_PURCHASEORDER_2.cds`, `API_MATERIAL_DOCUMENT.cds`, `API_BUSINESS_PARTNER.cds` (git-ignored,
not edited by hand). `../s4-apis.cds` adds the project's own annotations (no HTTP exposure).
After importing: `npm test` runs the adapter suites too.
