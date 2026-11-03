# ADR 0008 - S/4HANA API adapter

- Status: accepted
- Date: 2026-11-03
- Phase: 10

## Context

Phase 1-8 ran against a hand-made mock (`mock-po-service.js`). Phase 10 adds an adapter over the
official SAP APIs - **without** a connection to a real S/4HANA system (that is phase 11).

## Decisions

1. **Official definitions, imported unmodified.** API_PURCHASEORDER_2 (OData V4, 1.3.0),
   API_MATERIAL_DOCUMENT_SRV (OData V2, 1.3.0), API_BUSINESS_PARTNER (OData V2, 1.6.0), SAP S/4HANA,
   downloaded from the Business Accelerator Hub (`srv/external/specs`, provenance in its README)
   and imported with `cds import` to `srv/external/s4`. Both protocols stay as they are; CAP's
   remote clients (`kind: odata` / `odata-v2`) speak each one. The newer V4 Purchase Order API
   was chosen over the V2 `API_PURCHASEORDER_PROCESS_SRV`.

2. **One facade, two implementations.** `s4-adapter.js` extends `FacadeService`, so the Phase 8
   guard (5 s timeout, MessageLog, correlation ID, 503 S4_UNAVAILABLE) wraps it unchanged - there
   is no second timeout or logging. It returns exactly the facade contract's shapes; every SAP
   field name stays inside the adapter. InvoiceService, the matching engine and the domain model
   are unchanged.

3. **Selection by configuration only.** `development`/`test`: mock (default, unchanged).
   Profile `s4-adapter` (`CDS_ENV=s4-adapter`, `npm run watch:s4`): the adapter; it is an
   *important* profile (`[s4-adapter!]`) so it also wins over `test`. `production`: the adapter.
   Without credentials the SAP APIs are CAP's local mocks (`cds watch` / `--with-mocks`), with
   SAP-shaped data in `mock-data/s4api`; MessageLog then says `S4_CAP_MOCK`, with credentials
   `S4`. Explicit errors, never a fallback to the mock implementation: missing SAP service
   configuration, a mix of remote and mocked APIs, no credentials in production, or no
   credentials without mocking.

4. **The imported services are never served over HTTP** (`srv/external/s4-apis.cds`,
   `@protocol: 'none'`). Found during this phase: CAP's local mocks were otherwise public OData
   endpoints that let clerks and buyers read every PO and supplier, past the purchasing-group
   restrictions. Tested: 404 for every role.

5. **Read-only.** Only SELECTs (HTTP GET, verified against a fake SAP server). The Material
   Document API's `Cancel`/`CancelItem` actions and all entity writes are never used.

## Mapping

| Facade | SAP |
|---|---|
| Supplier.supplierID / name | A_Supplier.Supplier / SupplierName |
| Supplier.isPostingBlocked | A_Supplier.PostingIsBlocked (central posting block) |
| Supplier.country | **null** - see limitations |
| PO header | PurchaseOrder: PurchaseOrder, Supplier, CompanyCode, PurchasingGroup, DocumentCurrency, PurchaseOrderDate; isDeleted = PurchaseOrderDeletionCode not empty |
| PO item | PurchaseOrderItem: PurchaseOrderItem, Material, PurchaseOrderItemText, OrderQuantity, PurchaseOrderQuantityUnit, NetPriceAmount (netPrice), NetPriceQuantity (priceUnit), InvoiceIsGoodsReceiptBased (grBasedIV); isDeleted = PurchasingDocumentDeletionCode not empty (deleted or blocked) |
| Received quantity | A_MaterialDocumentItem filtered by PurchaseOrder: 101 +, 102 -, per PurchaseOrderItem, in the order unit |

- **Price unit:** NetPriceAmount is the price of NetPriceQuantity units of OrderPriceUnit - the
  facade's netPrice/priceUnit, as long as OrderPriceUnit is the order unit (or empty). Otherwise
  the item is refused: the metadata names the conversion factors ("Numerator for Conversion of
  Order Price Unit into Order Unit") but not the formula, and a wrong guess would mis-price
  every invoice line. NetPriceQuantity 0 is refused too.
- **101/102:** each material document item counts once (key year/document/item). A cancelled 101
  (`GoodsMovementIsCancelled`) still counts, because its cancellation is the 102 document, which
  is subtracted - excluding the cancelled 101 as well would count the reversal twice.
  `ReversedMaterialDocument*` is not needed for the sum. Quantity: QuantityInEntryUnit if
  EntryUnit is the order unit, else QuantityInBaseUnit if the base unit is the order unit, else
  refused. Exact decimal arithmetic (`Ratio`).
- **Other movement types** on the PO (e.g. 122 return to supplier, 103-106 blocked stock, 161
  returns) could change what was received; they are **refused** (call fails, logged
  `UNSUPPORTED_MOVEMENT_TYPE`), never ignored. The contract only defines 101/102.
- **Refusals** surface like every other S/4 failure: logged FAILED with the reason, 503
  S4_UNAVAILABLE for the user (the guard maps every non-404 failure). The user text ("not
  available, try again") is imprecise for these permanent data cases - acceptable now, a
  candidate for a dedicated code later.

## Limitations and risks

- **Supplier country is null.** A_Supplier has no country; the business partner address has
  one, but the API metadata defines no referential constraint between supplier and business
  partner (the association `A_BusinessPartner.to_Supplier` has none), so the link would be a
  guess. Country is display-only in this application.
- **Company-code posting block** (`A_SupplierCompany.SupplierIsBlockedForPosting`) is not
  checked: `getSupplier` has no company code. Supplier `DeletionIndicator`, purchasing and
  payment blocks are not mapped either. Candidates for a contract extension.
- **Units of measure** are passed through. SAP may use internal or ISO unit codes; they must
  match the units entered on invoices (phase 11 configuration).
- **Paging:** at most 200 results per value-help search; material document items and PO items
  are read in one request each - server-side paging of very large POs is not followed yet.
- **Timeout:** the guard answers after 5 s, but CAP's HTTP request itself is not aborted (CAP's
  RemoteService takes no AbortSignal); it ends with CAP's own request timeout.
- **Server log:** CAP's `[remote]` logger prints raw SAP error responses (URLs, message texts)
  to the server console. MessageLog and user messages are sanitized; console logging must be
  configured for production (phase 11).
- **One MessageLog row per facade call,** even when the adapter makes two SAP requests
  (getReceivedQuantities reads the PO and the material documents).
- **Service names with underscores** cannot be configured with `cds_requires_<name>_...`
  environment variables; use `CDS_CONFIG`, `cds bind` or destinations.

## Tests

- `test/integration/facade-contract.js`: one contract, run against the mock
  (`facade-contract.mock.test.js`) and the adapter over CAP's local mocks
  (`facade-contract.s4-adapter.test.js`) with identical expectations - only class name, target
  system and country differ by design. Plus adapter-only cases (cancelled receipt, 122, price per
  another unit), an end-to-end submit + match on the adapter, HTTP exposure and read-only checks.
- `test/integration/s4-adapter-remote.test.js`: CAP's real OData V2/V4 clients against a fake SAP
  server on localhost - URLs, GET only, V2 parsing, SAP error -> 503 with a sanitized log.
- `test/unit/s4-adapter-mapping.test.js`: mapping rules and configuration errors.

## Not done (phase 11)

Destinations/credentials, SAP communication arrangements, authentication, real-system tests.
No real S/4HANA endpoint was contacted in this phase.

## Update (phase 11)

Permanent refusals (unsupported movement type or price unit) now answer **502
S4_DATA_UNSUPPORTED** ("Retrying will not help") instead of 503 S4_UNAVAILABLE, the SAP HTTP
request is cut after 5 s (`requestTimeout`), and CAP's raw `remote` error log is off in
production - see ADR 0009.

## Update (public repository)

The public repository does not contain the SAP API specifications or the models `cds import`
generates from them (licensing not verified). Users obtain them with their own SAP account
(`docs/sap-api-setup.md`); without them the adapter test suites are skipped and the
`s4-adapter` and production profiles cannot start. The adapter code itself is unchanged.
The SAP-shaped mock data is no longer committed either: `mock-data/s4api/fixtures.js` holds only
the fields the adapter reads, and the CSVs with the full column set of the imported models are
generated locally (`npm run s4:fixtures`).
