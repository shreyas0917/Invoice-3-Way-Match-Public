# Demo script - Invoice 3-Way Match Workbench (10 minutes)

A click-through of the complete workflow in the five Fiori apps. No terminal is needed once
the server runs. Every step below was run in a real browser (headless Chrome) against this
code before it was written down.

## Before the demo (once)

1. `npm install`, then `npm run watch` (or `npx cds serve all`). Open **http://localhost:4004**:
   the launch page lists the five apps and the users.
2. Data: S/4HANA suppliers, purchase orders and goods receipts are **MOCK** data; tolerance rules
   (price +2 % / 500, -5 % / 500; quantity 0) and auto-release limits (1,00,000 INR) are seeded.
   The database is in memory: restarting the server resets it.
3. Users log in with HTTP basic authentication and an **empty password**. A browser remembers one
   login per site, so use **one private window per user** (or separate browser profiles):
   window A `clerk1`, window B `buyer1`, window C `manager1`, window D `buyer2`.
4. Optional, so that buyer2 has something to see in step 15: as `clerk1`, create one more invoice
   exactly like step 5 but with supplier `1000020`, PO `4500000103`, PO item `00010`, quantity 100,
   unit price 4.70, net/gross 470, and press **Match** (a price variance for purchasing group 002).

## The demo

| # | User | Where | Do | You should see |
|---|---|---|---|---|
| 1 | clerk1 | http://localhost:4004/invoices/webapp/index.html | Open the Invoice Workbench. | Status tabs with counts: All, Open, Validated, Exception, Pending Approval, Blocked, Released. |
| 2 | clerk1 | Invoice Workbench | **Create**. General: Supplier `1000010` (value help), Supplier Reference `DEMO-1`, Invoice Date `Oct 20, 2026`, Purchase Order `4500000101` (value help fills supplier, company code, currency). Amounts: Net `30000`, Tax `0`, Gross `30000`. Items, first empty row: PO Item `00010`, Quantity `20`, Unit `EA`, Unit Price `1500`, Net Amount `30000`. **Create** (save). | Status **Validated**, an invoice number **INV-2026-00000n** (the next free one), supplier name and purchasing group filled in. A wrong amount instead shows a message on the field and keeps the draft. |
| 3 | clerk1 | same invoice | **Match**. | Status **Matched** (green). Matching Results: PO price 1,500, received 50, previously invoiced 0, rule "Global: +2.00 % / -5.00 % ...". Only Release and Block are enabled. |
| 4 | clerk1 | same invoice | **Release**. | Status **Released**; Approval History shows SUBMIT, MATCH, RELEASE by clerk1. |
| 5 | clerk1 | Invoice Workbench | Create a second invoice like step 2 but Reference `DEMO-2`, Quantity `10`, Unit Price `1575`, Net/Gross `15750`. Save, then **Match**. | Status **Exception** (orange). Header **Money at Stake 750.00 INR**. Exceptions: Price Variance, BUYER, group 001, 750.00 INR. Only Block is enabled. |
| 6 | clerk1 | same invoice | Show **Block**: open the dialog and press Block without a reason, then Cancel. | "Enter a reason." on the reason field; nothing changes. |
| 7 | buyer1 | http://localhost:4004/exceptions/webapp/index.html | Open the Exception Worklist. | Tab **Open (1)**: only the group 001 price variance of DEMO-2, largest amount first. |
| 8 | buyer1 | Exception Worklist | Select the row, **Resolve**: Resolution **Accept** (the dropdown offers Accept, Rematch, Reject - for a missing goods receipt it offers only Rematch and Reject), Note `5 % surcharge agreed with the supplier`. **Resolve**. | Exception **Resolved** by buyer1. Opening it shows the decision and the invoice status **Pending Approval**. |
| 9 | manager1 | http://localhost:4004/approvals/webapp/index.html | Open the Approval Queue. | The DEMO-2 invoice with "Why Approval Is Needed: **Accepted variance**". |
| 10 | manager1 | Approval Queue | Open the invoice: show Matching Results, Exceptions and Decisions, Approval History, "Entered By (cannot approve): clerk1". Back to the list, select it, **Approve**, Comment `Surcharge accepted`. | The invoice leaves the queue. (Approving an invoice you entered yourself is refused: "You created this invoice, so you cannot approve it.") |
| 11 | manager1 | http://localhost:4004/invoices/webapp/index.html | Open the DEMO-2 invoice (tab Released). | Status **Released**. Approval History: SUBMIT, MATCH (clerk1), RESOLVE (buyer1, with the note), APPROVE (manager1, with the comment). Change History lists the field changes. |
| 12 | manager1 | http://localhost:4004/tolerances/webapp/index.html | Tab **Tolerance Rules**: open the global PRICE rule. | Limits, validity and "How Rules Are Applied" (both limits must hold; company rule overrides global; dates inclusive; no currency conversion). Tab **Approval Policies**: 1010 and 1020 at 1,00,000 INR. |
| 13 | manager1 | Tolerance Configuration | Optional: **Create** a rule for company code 1010, PRICE, 3 % / 1000 INR, valid from Jan 1, 2026; save. Create a second one from Jun 1, 2026. | The first is saved (draft, then active). The second is refused: "Another active PRICE rule for company code 1010 is valid in this period". |
| 14 | manager1 | http://localhost:4004/integration-log/webapp/index.html | Open the Integration Log. | One row per S/4 call made so far (submit: getSupplier + getPurchaseOrder; match: + getReceivedQuantities; value helps), newest first, all **SUCCESS** to **S4_MOCK**, with invoice number, duration and correlation ID. Calls of one request share a correlation ID: type part of one into Search. Nothing is invented. |
| 15 | buyer2 | http://localhost:4004/exceptions/webapp/index.html | Open the Exception Worklist. | Only purchasing group 002 (the optional exception from the preparation), never buyer1's group 001. |

## Talking points

- Rules live in the backend: status machine, tolerance engine, authorization. Buttons are only
  convenience; every action is checked again on the server (stale data gets 412, wrong role 403).
- Buyers work only in ExceptionService and only see their purchasing group's BUYER exceptions.
- What is mocked: S/4HANA data (MOCK) and users (mocked authentication). The Integration Log is
  real, but all calls it shows went to the mock.
- Optional failure demo: restart with `cds_requires_ExternalPurchaseOrderService_mock_failureMode=timeout`
  (README), press **Match** on a validated invoice: after 5 s "The S/4HANA system is not available
  right now. Nothing was changed", the invoice stays Validated, and the Integration Log shows three
  red FAILED rows with one correlation ID. Restart without the setting and Match again: it works.
  (This optional step was verified over HTTP and in the Integration Log app, not by clicking
  Match in the Workbench.)

## Known limitations of the local demo

- **Switching users** needs separate private windows/profiles (basic authentication is cached).
- **Buttons do not know roles locally**: e.g. clerk1 sees Approve enabled on a pending invoice and
  gets "403 Forbidden" when pressing it. The deployment configuration prepared in phase 11 would
  behave the same (the launch page lists all apps; the backend refuses) - BTP deployment and live
  service verification were not completed; role-based tiles would need SAP Build Work Zone.
- **Saved variants** ("My open invoices": filter Created By = you on the Open tab, then
  Save As in the variant menu) are stored in the browser's local storage only.
- **"There are no entries yet"** appears in sections that are empty for a reason (no exceptions,
  no match run yet).
- After Save, the browser console logs a harmless UI5 message ("Failed to drill-down into
  items(...IsActiveEntity=false)") about draft messages of rows that no longer exist; nothing is
  shown to the user.

## Running the demo on SAP BTP (phase 11) - not yet done

The app has **not been deployed**; none of the steps below has been run on BTP. After deployment
(README, "Deploying to SAP BTP") the demo is the same, with these differences - each must be
checked and recorded when it is first run:

| Step | Difference on BTP | Verified |
|---|---|---|
| Before the demo | Open the App Router URL (route of app `invoice-workbench`, shown by `cf apps` after `cf deploy`). Users log in through XSUAA (the IdP of the subaccount), not with mocked users. Assign `AP_Clerk`, `AP_Buyer_001`, `AP_Buyer_002`, `AP_Manager` role collections to four test users first. | no |
| 1-15 | Same clicks. Data lives in SAP HANA Cloud and survives restarts (locally it resets). | no |
| Supplier / PO value helps, Match | Answered by the S/4 adapter through the `S4HANA_*` destinations, not by MOCK data. Without destinations every S/4 call fails with "The S/4HANA system is not available right now" - the demo then shows only the failure handling (Integration Log, invoice stays Validated). With the api.sap.com sandbox the suppliers, POs and goods receipts are SAP's demo data: use IDs that exist there, not the MOCK IDs of this script. | no |
| 14 Integration Log | Target system `S4` instead of `S4_MOCK`. | no |
| Optional preparation 4, failure demo | MOCK-only (failure modes exist only in the mock); not available on BTP. | n/a |

The blueprint's completion criterion for phase 11 - "deployed app passes the demo script with real
login, and a recording is saved" - is open until this table is filled in.
