# Interview preparation

Questions an interviewer may ask about this project, with answers based on the repository. Each
answer names where to look, so you can show the code. **Follow-up** lines are the harder questions
that usually come next.

Golden rule for every answer: say what is **verified** (local, tested) and what is **not**
(BTP deployment, real S/4HANA). Interviewers trust a candidate who knows the limits of their work.

---

## A. Technical questions (30)

**1. What does the application do, in one sentence?**
It checks supplier invoices against purchase orders and goods receipts (three-way match) within
tolerances, and sends every mismatch to the buyer or AP manager who must decide it.

**2. Which technologies did you use?**
SAP CAP Node.js 10, CDS, OData V4, SAP Fiori elements (SAPUI5 1.148), SQLite locally, SAP HANA Cloud
configured for BTP, Jest for tests, MTA/App Router/XSUAA for the prepared BTP deployment.

**3. How is the code organised?**
`db/` model and seed data, `srv/` services and thin handlers, `srv/lib/` pure business logic,
`srv/external/` the S/4 facade and its implementations, `app/` five Fiori apps, `mock-data/` MOCK S/4
data, `test/` unit, service and integration tests.
- Follow-up: *Why put logic in `srv/lib` instead of the handlers?* Pure functions need no database or
  server, so they are fast to unit-test and safe to call twice.

**4. How many tests are there and what kinds?**
388 tests in 24 suites (30 adapter tests need the SAP API files, which are not in the repository): unit tests of pure logic, service tests that send real OData requests to the
running CAP server, and integration tests for the facade contract. `npm test` runs them.
- Follow-up: *What is not tested automatically?* The UI is checked by a manual/scripted browser
  click-through (demo script), and nothing is tested against a real BTP or S/4 system.

**5. What is a CAP "service" in your project?**
A CDS `service` definition with entities and actions, plus an optional JS handler class. Five:
InvoiceService, ExceptionService, AdminService (OData), MatchingEngine and ExternalPurchaseOrderService
(in-process only, `@protocol: 'none'`).

**6. What happens when a clerk saves an invoice?**
CAP's draft activation runs `before SAVE` in `srv/invoice-service.js`: CDS field checks, then rules
V1-V3 (amounts, items), V4-V10 (against supplier and PO data from the facade), then the duplicate
check D1. Errors are attached to the fields; the draft stays. On success the status becomes VALIDATED
and an invoice number `INV-<year>-<6 digits>` is assigned.

**7. How do you calculate money without floating-point errors?**
`srv/lib/decimal.js` converts amounts to BigInt counts of the smallest unit, and uses an exact
fraction type `Ratio` for divisions. Rounding happens only when storing.
- Follow-up: *Why not just `toFixed(2)`?* `toFixed` rounds a value that may already be wrong
  (0.1 + 0.2 = 0.30000000000000004); exact integers never have that error.

**8. What is a price unit and why does it matter?**
A PO price can be given per 100 units (paper: 450 per 100 sheets). The unit price is
`netPrice / priceUnit` = 4.50. Treating 450 as the price of one sheet would flag every invoice line.

**9. How do you handle a goods receipt reversal?**
Net received = sum of movement type 101 minus sum of 102. In the S/4 adapter a cancelled 101 still
counts, because its 102 is subtracted; any other movement type is refused, not ignored.

**10. What is the output of a match run?**
One `MatchResults` row per item (prices, quantities, variances, applied rules), zero or more
`Exceptions`, item match statuses, a new invoice status and an ApprovalHistory row.

**11. How do you know which tolerance rule applied?**
`appliedPriceRule_ID` / `appliedQtyRule_ID` are stored in MatchResults; the UI shows them as text
("Global: +2.00 % / -5.00 % ...").

**12. What is a draft and why use it?**
Fiori's edit mode: the user's changes are saved in a draft table until "Save". It lets the user work
on a half-finished invoice and see validation messages on fields without creating an invalid record.

**13. How do you prevent two users overwriting each other?**
ETags on `modifiedAt`: writes need `If-Match`; a stale ETag gives 412, a missing one 428.

**14. What does 409 mean in your APIs?**
A business conflict: invalid status transition, exact duplicate invoice, S/4 data changed since
submission, overlapping tolerance rule, active invoice cannot be deleted.

**15. What does the status machine do?**
`srv/lib/status-machine.js` holds the allowed transitions and `transition()`, the only function that
writes the invoice status after submission. It updates the row only if the status is still the
expected old one and writes the audit row in the same transaction.

**16. How is the approval decision made?**
No exception and gross amount within the company's auto-release limit -> MATCHED (clerk can
release). Above the limit, or no usable policy, -> PENDING_APPROVAL for an AP manager.
- Follow-up: *What if the policy's currency differs?* PENDING_APPROVAL with reason
  POLICY_CURRENCY_MISMATCH and a warning - the safe default.

**17. What is the Integration Log?**
The `MessageLog` entity shown read-only to AP managers: one row per S/4 facade call with correlation
ID, operation, invoice, target system, SUCCESS/FAILED, duration and a sanitized error.

**18. What is a correlation ID here?**
CAP's request ID (`cds.context.id`), shared by all S/4 calls of one user request, so you can see
which calls belonged together. A caller can pass `x-correlation-id`.

**19. How do you test a timeout without waiting 5 seconds?**
Unit test of `withTimeout` with Jest fake timers: pending at 4,999 ms, rejected at 5,000 ms, no timer
left. Service tests set the configured timeout to 200 ms.

**20. How do you simulate an SAP failure?**
The mock reads `cds.requires.ExternalPurchaseOrderService.mock.failureMode` (`none`, `timeout`,
`error`) on every call. Only the mock reads it; a unit test checks no other file does.

**21. What does the user see when S/4 is down?**
503 `S4_UNAVAILABLE`: "The S/4HANA system is not available right now. Nothing was changed; please try
again later." Technical details stay in the log.

**22. And when S/4 sends data you cannot process?**
502 `S4_DATA_UNSUPPORTED`: "Retrying will not help" - for example an unsupported movement type.

**23. How are the Fiori apps built?**
Fiori elements templates (List Report, Object Page) configured by `manifest.json` and CDS annotations
(`app/*/annotations.cds`, `srv/annotations/*.cds`). No custom JavaScript UI code.

**24. What bugs did you find in browser testing?**
All apps rendered blank (missing full-height CSS); an item currency annotation made Fiori show an
editable field that blocked saving; the Approval Queue did not refresh after approving (fixed with a
side effect). See ADR 0006.

**25. How is configuration different between environments?**
CAP profiles in `package.json`: `[development]`/`[test]` (mocked users, SQLite, mock S/4),
`[s4-adapter!]` (adapter with local SAP mocks), `[production]` (HANA, XSUAA, adapter over destinations).

**26. How is mock data kept out of production?**
`mock-data/` models are only required in development/test profiles; the production build output
contains no `s4mock` or `s4api` tables (checked), and the adapter refuses to start in production
without credentials.

**27. Why are the SAP API mocks not reachable over HTTP?**
CAP's local mocks would otherwise be public OData endpoints that let a buyer read all POs. They are
annotated `@protocol: 'none'` (`srv/external/s4-apis.cds`); tests check 404 for every role.

**28. What does `cds import` do?**
Converts an EDMX (OData V2 or V4 metadata) into a CDS model of the remote service, which CAP can
call remotely or mock locally.

**29. How do you generate SAP-shaped test data?**
`scripts/generate-s4-fixtures.js` writes CSVs from `mock-data/s4api/fixtures.js` and fills every
non-nullable SAP column with an empty value; it fails if a fixture uses a field that does not exist
in the official definition.

**30. What would you improve next?**
Deploy to BTP and run the demo there; a real number range for invoice numbers; company-code posting
block of suppliers; unit-of-measure mapping; a user time zone for "invoice date in the future".

---

## B. Architecture and design (15)

**1. Why one application and not microservices?**
One business process, one team, and a match must update several tables atomically. A modular
monolith (ADR 0001) keeps one transaction; service boundaries still exist inside.
- Follow-up: *How would you split it later?* MatchingEngine and the facade already have typed
  contracts and no shared state; they could move out behind the same CAP service interface.

**2. Why is the matching engine a pure function?**
It gets all data as input and returns verdicts; no I/O. That makes it deterministic, unit-testable
and safe to retry. InvoiceService does reading and writing.

**3. Why a facade for S/4?**
To keep SAP field names and protocols out of business logic, to swap mock and real implementation by
configuration, and to put timeout/logging/error mapping in one place.

**4. What happens if someone adds a new S/4 implementation without the guard?**
InvoiceService checks at startup that the facade is a `FacadeService` and refuses to start otherwise.

**5. Why read S/4 data again during match if it was checked on Save?**
S/4 may have changed (PO deleted, supplier blocked); match re-runs V4-V10 and answers 409 before
writing anything.

**6. Why does an exception belong to a match run?**
So decisions from an earlier round do not affect a new one: after unblock and rematch, an old REJECT
must not block the invoice again (ADR 0004).

**7. Why is the Approval Queue a server-side projection and not a UI filter?**
A client cannot remove a server-side `where status = 'PENDING_APPROVAL'`, and the queue can have its
own role restriction and buttons (ADR 0006).

**8. Why store MatchResults insert-only?**
Every run stays auditable; `lastMatchRunID` marks the current one.

**9. How is the MessageLog written if the business transaction rolls back?**
Rows are collected per request and written in a new transaction after the request ends.
- Follow-up: *Why not a second transaction immediately?* SQLite has a single writer; a second
  writing transaction would wait forever for the open one. Trade-off: a crash mid-request loses rows.

**10. Why SQLite locally?**
Zero setup and a fresh in-memory database per test file; the model has no database-specific SQL, so
it builds for HANA unchanged.

**11. What is the role of the App Router on BTP?**
Login through XSUAA, serving the five apps, forwarding `/odata` with the user's token to CAP. CAP
itself also checks the token.

**12. How did you decide where each validation rule lives?**
Single-field rules declaratively in CDS (`@mandatory`, `@assert.range`); cross-field and S/4 rules as
pure functions; the duplicate check last, as a 409 (ADR 0002).

**13. What is the hardest design trade-off you made?**
Refusing data the adapter cannot map with certainty (other movement types, price per another unit)
instead of guessing. It may block some invoices, but it never calculates a wrong received quantity.

**14. What is configurable without code changes?**
Tolerance rules, approval limits (Tolerance Configuration app), the facade implementation, timeout,
mock failure mode, SAP destinations.

**15. What does "verified" mean in your README?**
Proven by an automated test or a recorded run. BTP deployment and S/4 connectivity are explicitly
"not verified".

---

## C. SAP CAP (10)

**1. What is CDS?**
Core Data Services: the language to define the data model, services and annotations; CAP generates
database artefacts and OData APIs from it.

**2. How do `@requires` and `@restrict` differ?**
`@requires` is a role check on a whole service or entity; `@restrict` adds grants per event (READ,
WRITE, actions) and optional `where` conditions per row.

**3. What is `$user.purchasingGroup`?**
A user attribute (from mocked users locally, from the XSUAA token on BTP) used in `@restrict` where
conditions.

**4. What are `before`, `on`, `after` handlers?**
Phases of CAP request processing: validate/enrich before, implement on, post-process after. The app
uses `before SAVE` for validation, `on` for actions, `after READ` for computed fields.

**5. How do you call one CAP service from another?**
`cds.connect.to('MatchingEngine')` then `send('evaluate', data)`; in-process, in the same transaction.

**6. What is `@protocol: 'none'`?**
The service exists in-process but is not served over HTTP.

**7. What does `@odata.draft.enabled` give you?**
Draft tables and the edit/activate actions Fiori uses; `before SAVE` runs on activation.

**8. What are CAP profiles?**
Configuration sections like `[development]`, `[production]` in `package.json`; `[s4-adapter!]` is an
"important" profile that wins over `[test]`.

**9. How does CAP talk to a remote OData service?**
A required service with `kind: odata` (V4) or `odata-v2` and credentials (URL or destination). CQN
queries are translated to OData URLs; responses are converted back.
- Follow-up: *How did you verify the translation?* A test with a fake SAP server on localhost checks
  the generated URLs, for example `substringof('steel',tolower(SupplierName))` for V2.

**10. What does `cds build --production` produce?**
`gen/srv` (the CAP app with compiled model) and `gen/db` (HDI artefacts and seed data for HANA).

---

## D. Data and matching engine (10)

**1. In which order are items checked?**
Price, goods receipt, quantity. The first failure is the item's result; every failure becomes an
exception.

**2. Why skip the quantity check after NO_GR?**
Without a receipt there is nothing to compare against, and NO_GR already blocks payment; otherwise
one cause would create two exceptions (ADR 0003).

**3. What is the open quantity?**
(GR-based: net received; 2-way: ordered) minus quantities on other non-cancelled invoices for the PO
item, minus earlier lines of the same invoice.

**4. How does the price tolerance work?**
Percent and absolute amount must both be within the limit, separately for above and below the PO
price. Global default: +2 % / 500 INR above, -5 % / 500 INR below.

**5. Company rule vs global rule?**
An active company rule valid on the invoice date wins; else the global rule; else zero tolerance
with a warning.

**6. Are limits inclusive?**
Yes; exactly at the limit passes.

**7. What is "money at stake"?**
Per exception: price difference x quantity, excess quantity x PO price, NO_GR invoiced value, or the
gross amount for a suspected duplicate.

**8. How is a suspected duplicate different from an exact duplicate?**
Exact (D1, same normalised reference and fiscal year) blocks Save. Suspected (D3, same supplier, date
and amount, different reference) is an exception for the AP manager to decide.

**9. Why normalise the supplier reference?**
`INV-0045`, `inv 45` and `INV/45` are the same invoice typed differently.

**10. What if two match requests run at the same time?**
Only one succeeds; the other gets 409 and writes nothing - the status change is a compare-and-set
before any results are written. Tested with parallel requests (blueprint test R2).

---

## E. Security and integration (10)

**1. How do you stop a buyer seeing another group's exceptions?**
Instance restrictions with `$user.purchasingGroup` on every exposed entity, and no associations that
reach unrestricted rows. Other groups' records answer 404.

**2. What leak did you find?**
`$expand` from an own-group invoice to its exceptions showed an AP-manager-only duplicate exception -
CAP applies the target restriction only on direct access. The association was removed from
ExceptionService (ADR 0005).

**3. How is segregation of duties enforced?**
`approve` compares approver and creator in the handler (403 `SOD_SELF_APPROVAL`) - CDS cannot compare
two values of the same record.

**4. What if a buyer has no purchasing group on BTP?**
They see nothing. XSUAA's attribute is required on the Buyer role; CAP turns a missing or empty
value into a condition that matches no rows (tested).

**5. Which SAP APIs does the adapter use?**
API_PURCHASEORDER_2 (OData V4), API_MATERIAL_DOCUMENT_SRV (V2), API_BUSINESS_PARTNER (V2), official
definitions from the SAP Business Accelerator Hub, read-only.

**6. Did you connect to a real S/4HANA?**
No. The adapter is tested against CAP's local mocks and a fake SAP server on localhost. Destinations
for BTP are configured but never used.
- Follow-up: *What would change for a real system?* Only configuration: three destinations (URL and
  authentication); for on-premise also Cloud Connector.

**7. Why is supplier country null in the adapter?**
`A_Supplier` has no country and the metadata does not define the supplier-to-business-partner link;
guessing could show a wrong country. It is display-only.

**8. How are secrets handled?**
None in Git: XSUAA/HANA credentials from service bindings, S/4 credentials in destinations, local
settings in a git-ignored `.env` (`.env.example` lists them). Error texts are sanitized before
logging.

**9. What happens if SAP is slow?**
The guard answers after 5 s with 503; in production the HTTP request itself is aborted after 5 s
(`requestTimeout`). The failed call is logged with duration and correlation ID.

**10. Is the BTP deployment done?**
Prepared, not done: `mta.yaml`, `xs-security.json`, App Router and production profile exist and the
MTA archive builds; the App Router and production profile were started locally with fake bindings.
No `cf deploy`, no real login, no HANA - because no BTP account was available.

---

## Difficult follow-ups to prepare

- *"If HANA has row locks, why do you need compare-and-set?"* - SQLite has none, and the
  compare-and-set also protects against any code path that skips the lock.
- *"Your MessageLog can lose rows - is that acceptable?"* - Only on a process crash in the middle of a
  request; documented trade-off. On HANA it could write immediately in its own transaction.
- *"Why 503 and not 500 for SAP errors?"* - The service is temporarily unavailable, not an
  application bug; clients may retry. Permanent data problems use 502 with "retrying will not help".
- *"How do you know your tests are not just testing the mock?"* - The same contract runs against the
  adapter with SAP-shaped data, and the adapter's real OData clients are tested against a fake SAP
  server. A real system is still untested - say so.
- *"What would break with 10,000 suppliers?"* - Value helps are capped at 200 results; server-side
  paging of very large POs is not followed yet (ADR 0008).
- *"Why not use the HANA free tier now?"* - No BTP account was available; the steps are documented
  and the archive is ready.
