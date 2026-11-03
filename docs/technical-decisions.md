# Technical decisions - deep dive

The important engineering decisions, explained against the actual code. Each section names the
files and ADRs it is based on.

## 1. Why SAP CAP instead of an Express-only application

The app needs OData V4 for SAP Fiori elements, draft handling for invoice entry, declarative
authorization, and a model that runs on SQLite locally and SAP HANA on BTP. CAP provides all of
these from the CDS model:

- **OData V4 and Fiori elements** from `srv/*-service.cds` and annotations in `app/*/annotations.cds` -
  no hand-written REST endpoints and no custom UI code (ADR 0006).
- **Draft handling** (`@odata.draft.enabled` on Invoices and ToleranceRules): Fiori's edit/save
  cycle, draft messages on fields and ETags come from CAP; the app only adds `before SAVE` checks.
- **Authorization** in CDS (`@requires`, `@restrict` with `where` conditions), enforced for every
  request (ADR 0005).
- **Database portability**: the same model deploys to SQLite and to HANA (`cds build --production`
  generated HDI artefacts in phase 11).
- **Remote services**: imported SAP API definitions (`cds import`) become CAP services; queries
  written once run against local mocks or remote OData V2/V4 (ADR 0008).

With Express alone, each of these would be custom code that has to be written, tested and kept
consistent.

## 2. Why a modular monolith instead of microservices

ADR 0001: one process, one database, one deployment, with concerns separated by CAP services
(InvoiceService, ExceptionService, AdminService, MatchingEngine, ExternalPurchaseOrderService).

- A match run writes results, exceptions, item statuses, invoice status and history; one database
  transaction keeps them consistent - no distributed transactions or sagas.
- Internal services (`@protocol: 'none'`) have typed contracts but no network hop.
- The service boundaries are already there: a module could move out later without changing its
  callers. For one team and one business process, separate deployments would add cost without
  benefit.

## 3. SQLite locally, SAP HANA Cloud for production

- **Local and tests:** `@cap-js/sqlite` in memory, seeded from CSV on every start. Each test file
  gets a fresh database; `data.reset` isolates tests. No installation needed.
- **Production (configured, not yet deployed):** `@cap-js/hana` in the `[production]` profile;
  `cds build --production` generates HDI artefacts (tables, views, triggers for change tracking).
- **Portability rule:** no database-specific SQL; only CQN queries and CDS annotations.
- **What goes to HANA:** only `db/data` (code lists, currencies, default tolerance rules, approval
  policies). Test data, MOCK S/4 data and local invoices are never deployed (checked in the build
  output).
- **SQLite caveat handled explicitly:** SQLite has no row locks (`forUpdate()` does nothing there),
  so concurrency safety does not rely on locks alone (section 11).

## 4. The facade pattern for SAP integration

`srv/external/purchase-order-facade.cds` is an anti-corruption layer: the application's own
contract in business terms (supplier, purchase order, received quantity).

- **Business logic never sees SAP field names.** `s4-adapter.js` maps `NetPriceAmount`,
  `PurchasingDocumentDeletionCode`, `GoodsMovementType` and so on to the contract.
- **Implementations are swapped by configuration only:** `cds.requires.ExternalPurchaseOrderService.impl`
  - `mock-po-service.js` in development/test, `s4-adapter.js` in profile `s4-adapter` and in production.
- **Cross-cutting behaviour lives in one place:** both implementations extend `FacadeService`, which
  installs the guard (timeout, logging, error mapping) as the first handler. InvoiceService refuses to
  start if the configured implementation is not a `FacadeService`, so the guard cannot be bypassed.
- **Testable before SAP exists:** the same contract test suite runs against both implementations
  (`test/integration/facade-contract.js`), and the mock can simulate timeouts and errors.

## 5. Exact decimal arithmetic

JavaScript numbers are binary floating point: `0.1 + 0.2 !== 0.3`. For invoice checks a rounding
error decides whether money is paid.

`srv/lib/decimal.js`:
- `toScaled(value, scale)` turns a decimal string or number into a **BigInt** count of its
  smallest unit (`'12.30'` at scale 2 is `1230n`), rounding half away from zero only if a value
  has more decimals than allowed.
- `Ratio` is an exact fraction of two BigInts for calculations that divide - the PO unit price
  `netPrice / priceUnit` (450 / 100 sheets) and variance percentages can be non-terminating.
  Nothing is rounded during the calculation.
- Values are rounded only when stored: unit price 4 decimals, percent 4, amounts 2, quantities 3
  (ADR 0003). All tolerance limits are compared exactly and inclusively.
- The same `Ratio` is used by the S/4 adapter to sum goods receipt quantities, which OData V2
  delivers as strings (`"50.000"`).

## 6. Goods receipts: movement types 101 and 102

The contract defines received quantity per PO item as **net = sum(101) - sum(102)**:
101 is a goods receipt, 102 the reversal of a receipt.

- **Mock** (`mock-po-service.js`): sums its MOCK goods receipt items with the sign of the movement type.
- **S/4 adapter** (`receivedQuantities()` in `s4-adapter.js`, ADR 0008):
  - reads `A_MaterialDocumentItem` by `PurchaseOrder` (OData V2);
  - each material document item counts once (key: year/document/item), so duplicate rows cannot
    double-count;
  - a **cancelled 101** (`GoodsMovementIsCancelled`) still counts, because its cancellation is the
    102 document, which is subtracted - skipping the 101 as well would count the reversal twice;
  - the quantity is taken in the PO's order unit (entry quantity, or base quantity if the base
    unit is the order unit), otherwise refused;
  - **any other movement type** (for example 122 return to supplier) is refused with
    `UNSUPPORTED_MOVEMENT_TYPE` (502 `S4_DATA_UNSUPPORTED` for the user) instead of being
    ignored, because it could change what was really received.
- In the matching engine, a GR-based item with net received <= 0 raises **NO_GR**, and the quantity
  check is skipped for that item (ADR 0003).

## 7. Tolerance rules

`srv/lib/tolerance.js`, configured in the Tolerance Configuration app (`ToleranceRules`):

- **Selection** for the invoice's company code, variance type (PRICE or QUANTITY) and invoice
  date: an active company rule valid on that date (validFrom/validTo inclusive), else the global
  rule (empty company code), else **zero tolerance** with warning `NO_TOLERANCE_RULE`. A rule in
  another currency than the invoice is not used (zero tolerance, warning), because absolute limits
  cannot be compared across currencies. Overlapping active rules are refused on save
  (409 `TOLERANCE_RULE_OVERLAP`).
- **Price check:** `pct = (invoice price - PO price) / PO price x 100`,
  `amount = difference x invoiced quantity`. Above the PO price both `pct <= upperPercent` and
  `amount <= upperAbsolute` must hold; below it the lower limits apply. Example: the seeded
  global rule is +2 % / 500 INR and -5 % / 500 INR.
- **Quantity check:** `excess = invoiced - open quantity`; partial invoices always pass; an excess
  passes only within the upper % (of the open quantity) and the upper amount (excess x PO price).
  Nothing open and something invoiced is always a variance.
- The applied rules are stored in MatchResults and shown as text ("Global: +2.00 % / -5.00 % ...").

## 8. Duplicate invoice detection

`srv/lib/duplicate.js`, `srv/lib/matching.js` (ADR 0002, 0003):

| Rule | When | Effect |
|---|---|---|
| D2 normalisation | always | supplier reference upper-cased, spaces `-` `/` `.` removed, leading zeros of numbers stripped: `inv-0045`, `INV 45`, `INV/45` all become `INV45` |
| D1 exact duplicate | on Save | same supplier + normalised reference + fiscal year as another non-cancelled invoice: **save blocked**, 409 `DUPLICATE_INVOICE` |
| D4 | on Save | cancelled invoices do not block a new invoice with the same reference |
| D3 suspected duplicate | during match | same supplier, same invoice date, same gross amount, **different** reference: a `DUPLICATE_SUSPECT` exception for the AP Manager (not the buyer) |

`checkDuplicates` (InvoiceService function) lets the UI ask before saving.

## 9. Status transitions and audit history

`srv/lib/status-machine.js` (ADR 0004):

- **One table** (`TRANSITIONS`): SUBMIT, MATCH, RESOLVE, RELEASE, APPROVE, REJECT, BLOCK, UNBLOCK,
  CANCEL with their allowed from/to statuses. A wrong move is 409 `INVALID_STATUS_TRANSITION`.
- **One writer:** `transition()` is the only code that updates `Invoices.status` after
  submission. It validates the move, runs `UPDATE ... where ID = ? and status = <expected old status>`,
  fails with 409 if the row changed meanwhile, and writes the ApprovalHistory row - in the caller's
  transaction. The matching engine and `statusAfterResolution()` only *propose* a status.
- **Resolutions:** when the last open exception of the current run is decided, any REJECT blocks
  the invoice, else any ACCEPT sends it to PENDING_APPROVAL (`ACCEPTED_VARIANCE`), else (all
  REMATCH) it returns to VALIDATED for a new match. Exceptions that can no longer be decided
  (invoice unblocked or cancelled) become SUPERSEDED.
- **Audit:** ApprovalHistory for decisions (who, role, when, why), change tracking for field
  changes, insert-only MatchResults for every run.

## 10. Authorization and purchasing-group isolation

ADR 0005, `srv/*-service.cds`, `test/service/auth.test.js`:

- Buyers use only ExceptionService (`@requires: ['Buyer', 'APManager']`); they cannot open
  InvoiceService at all (403).
- Instance restriction on Exceptions:
  `purchasingGroup = $user.purchasingGroup and responsibleRole = 'BUYER'` - for read and for
  `resolve`. Related invoices, items, results and history are restricted by the invoice's
  purchasing group. CAP adds the condition to every query, so changing a URL, key, `$filter` or
  `$batch` does not reveal other groups (other group's records answer 404).
- **Leak found and closed:** CAP does not apply the *target's* restriction to rows reached by
  `$expand`/navigation. A buyer could read an AP-Manager-only duplicate exception via
  `Invoices(...)?$expand=exceptions`. Those associations are therefore not exposed in
  ExceptionService; change history (which cannot be filtered by group) is switched off there.
- **Fails closed:** a Buyer without a purchasing group sees nothing. With XSUAA the attribute arrives
  as an array (`["001"]`, or several groups); CAP turns it into an OR - tested with XSUAA-shaped
  users (`test/service/xsuaa-user-attributes.test.js`).
- **Segregation of duties:** `approve` compares the approver with the invoice's creator in the
  handler (403 `SOD_SELF_APPROVAL`).

## 11. Concurrency

- **Optimistic locking for users:** ETags on `modifiedAt` of Invoices and Exceptions; a write needs
  `If-Match` (428 without it) and fails with 412 if the record changed.
- **Parallel Match on one invoice (blueprint test R2)** (ADR 0007):
  1. the invoice is read `forUpdate()` - a row lock on HANA/PostgreSQL;
  2. the status change happens **before** any result is written, as a compare-and-set
     (`UPDATE ... where status = 'VALIDATED'`); the losing request gets 409 and writes nothing;
  3. on SQLite (no row locks) writers are serialized, and the loser re-reads a non-VALIDATED status.
  No in-memory mutex is used. Tested with real parallel requests (5 rounds per run, 25/25 when
  repeated) and with a simulated interleaving where the status changes between read and write.
- **Invoice numbers:** a unique constraint on `invoiceNumber` makes a concurrent collision fail
  rather than create two equal numbers (a real number range is a documented later improvement).

## 12. Integration failures and logging

`srv/external/facade-guard.js`, `srv/lib/message-log.js` (ADR 0007, 0009):

- **Timeout:** every facade operation is limited to 5,000 ms; the operation gets an AbortSignal.
  In production the SAP HTTP request itself is also cut after 5 s (`requestTimeout`).
- **Error mapping:** a business "not found" (404) passes through; permanently unsupported data
  becomes 502 `S4_DATA_UNSUPPORTED` ("retrying will not help"); every other failure becomes 503
  `S4_UNAVAILABLE` ("nothing was changed; try again later"). Technical details never reach the user.
- **What a failure does:** a failed Save keeps the draft; a failed Match leaves the invoice VALIDATED
  with nothing partial written (the request's transaction rolls back).
- **MessageLog:** one row per call - correlation ID, operation, invoice, target system, SUCCESS/FAILED,
  duration, sanitized error (first line, URLs/tokens/passwords removed, max 300 characters). Rows
  are collected per request and written in a **separate transaction after the request ends**, so
  they survive the rollback. (Writing immediately in a second transaction would deadlock on SQLite,
  which has one writer; the trade-off is that a process crash mid-request loses those rows.)
- **Correlation ID:** CAP's `cds.context.id` - one per incoming request (or taken from the
  caller's `x-correlation-id`), shared by all calls of that request, isolated between parallel
  requests (tested).
- **Server console (production):** CAP's raw remote-error log is switched off; the guard writes a
  sanitized warning with the correlation ID instead.

## What is not claimed

- The BTP deployment is configured and builds, but has **not been deployed**; XSUAA login, HANA
  persistence and the demo on BTP are unverified.
- The S/4 adapter has been tested against CAP's local mocks and a fake SAP server on localhost.
  **No real S/4HANA (or SAP sandbox) endpoint has been called.**
