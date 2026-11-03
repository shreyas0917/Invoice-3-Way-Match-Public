# ADR 0003 - Matching engine, tolerances and match runs

- Status: accepted
- Date: 2026-11-02
- Phase: 4

## Context

The `match` action compares a VALIDATED invoice with its purchase order and goods receipts
within tolerances, records what it compared, raises exceptions and sets the outcome. The
blueprint defines the formulas; this record states how they are implemented and which
open points were decided.

## Decisions

1. **Pure engine, thin services.** All decisions are made by `evaluateInvoice()` in
   `srv/lib/matching.js` (with `srv/lib/tolerance.js`). It receives plain data and returns
   verdicts; it reads and writes nothing. `MatchingEngine` (`srv/matching-engine.cds/.js`,
   `@protocol: 'none'`) exposes it as an internal CAP service with a typed contract.
   `InvoiceService.match` gathers the data, calls the engine and persists the run.

2. **Order inside the action.** Guard (status must be VALIDATED, the row is read
   `forUpdate`) -> read supplier, PO and goods receipts through
   `ExternalPurchaseOrderService` and re-run the V4-V10 checks, because S/4 may have
   changed since submission (409 with the V-codes if so) -> read local data -> evaluate ->
   write. All writes happen in the request's single transaction, so a failure rolls back
   results, exceptions and status together.

3. **Exact arithmetic.** `Ratio` (BigInt fractions, `srv/lib/decimal.js`) is used for the
   PO unit price (`netPrice / priceUnit`, which can be non-terminating), variance percent and
   amounts. Values are rounded only when stored: PO unit price 4 decimals, percent 4,
   amounts 2, quantities 3. All limits are inclusive.

4. **Check order per item: price, goods receipt, quantity.** The first failure is
   `MatchResults.result`; every failure is an exception. *Decision:* when a GR-based item has
   no goods receipt (NO_GR), the quantity check is skipped, because there is nothing to
   compare against and NO_GR already blocks payment. Without this, every NO_GR would also
   raise a QTY_VARIANCE for the same root cause.

5. **Open quantity** = (GR-based ? net received 101 - 102 : ordered quantity) - quantity on
   other non-cancelled invoices for the PO item - quantity on earlier lines of the same
   invoice for that PO item. Other invoices are read from the app's own `ap` tables (the
   one source of truth), not from S/4; the blueprint's `getInvoicedQuantities` facade
   operation was therefore not added. Invoices of any status except CANCELLED count,
   including ones not matched yet.

6. **Money at stake per exception:** price = |price difference x invoiced quantity|;
   quantity = excess quantity x PO unit price; NO_GR = invoiced quantity x invoice price;
   suspected duplicate = invoice gross amount.

7. **Tolerance selection** uses the invoice date. Company rule, else global rule (empty
   company code), else zero tolerance with warning `NO_TOLERANCE_RULE`. *Gap:* the blueprint
   does not say what happens when a rule's currency differs from the invoice currency.
   Absolute limits are amounts, so they are never compared across currencies: such a rule is
   not applied, zero tolerance is used and `TOLERANCE_RULE_CURRENCY_MISMATCH` is returned as a
   warning. Overlapping active rules are rejected when a rule is saved (AdminService); if one
   slips through, the rule with the newest validFrom wins.

8. **Outcome.** Any exception -> EXCEPTION. Otherwise gross <= autoReleaseLimit -> MATCHED,
   above -> PENDING_APPROVAL with `approvalReason = OVER_AUTO_RELEASE_LIMIT` (new read-only
   field on Invoices, needed to say why approval is required). *Gap:* the blueprint does not
   cover a missing policy or a policy in another currency. Safe behaviour: PENDING_APPROVAL
   with reason `NO_APPROVAL_POLICY` / `POLICY_CURRENCY_MISMATCH` and a warning, so nothing is
   released without a limit check. No currency conversion.

9. **D3 suspect duplicate** runs during matching only: another non-cancelled invoice of the
   same supplier with the same invoice date and the exact same gross amount, but a different
   normalised reference. One header-level DUPLICATE_SUSPECT exception per such invoice, for
   the AP Manager, linked through the new `Exceptions.relatedInvoice` (otherwise the manager
   could not see which invoice it may duplicate). It never blocks submission.

10. **Match runs are immutable.** Each run gets a new `runID`; MatchResults are only ever
    inserted. `Invoices.lastMatchRunID` points to the latest run, and the
    `latestMatchResults` association shows only that run in the UI while `matchResults`
    keeps all runs. In phase 4 an invoice can be matched once (from VALIDATED); the REMATCH
    path that leads back to VALIDATED comes with the status machine in phase 5.

11. **Configuration.** Default tolerances (price +2 %/500, -5 %/500; quantity 0 %/0) and
    auto-release limits (1,00,000 INR for 1010 and 1020) are seed data in `db/data`.
    Tolerance rules are maintained (draft) through AdminService. `@changelog` annotations are
    in place; the change-tracking plugin itself is added in phase 5. Role restrictions
    (AP Manager only) follow in phase 6.

## Not done in this phase

- Exception resolution, the status machine and the release/approve/block/cancel actions (phase 5).
- Tolerance Configuration, Exception Worklist and Approval Queue apps (phase 7). The Invoice
  Workbench shows the Match button, the latest match results and the exceptions.
- MessageLog, timeouts and the failure modes of the facade (phase 8).
