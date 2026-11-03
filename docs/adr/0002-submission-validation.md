# ADR 0002 - Submission validation, duplicates and invoice numbering

- Status: accepted
- Date: 2026-11-02
- Phase: 3

## Context

On Save, a draft invoice must pass rules V1-V10 and the exact-duplicate rule D1 before it
becomes a VALIDATED invoice with a number. The blueprint leaves a few details open or
inconsistent; this record states what was chosen and why.

## Decisions

1. **Where each rule lives.** Single-field rules are declarative in `db/schema.cds`
   (`@mandatory`, `@assert.range` for quantity/price/tax/gross, `@assert` for "invoice date
   not in the future"). Cross-field rules (V1-V3) and rules against S/4 data (V4-V10) are pure
   functions in `srv/lib/invoice-validation.js`, called from `before SAVE` in
   `srv/invoice-service.js`. S/4 data is read only through `ExternalPurchaseOrderService`.
   *Known limitation:* "today" is the server's UTC time (`$now`). Between 00:00 and 05:30 IST
   an invoice dated today (IST) is still "in the future" in UTC and is rejected; a
   user/company time zone is a later improvement.

2. **Order and status codes.** CAP's input checks (`@mandatory`, `@assert.range`) run first and
   reject on their own. Then V1-V10 are collected with `req.error()` (400, all reported
   together). Only an otherwise valid invoice is checked for D1, which stops with
   `req.reject()` (409). The `@assert` date check runs in the database after the write
   and fails the same transaction. A failed Save rolls back completely; the draft keeps its
   data and CAP stores the messages as draft messages for Fiori.

3. **Money is compared exactly.** Amounts are converted to BigInt cents
   (`srv/lib/decimal.js`); `quantity x unitPrice` is computed at scale 5. Tolerance is
   +/- 0.01, inclusive, for V1, V2 and V3.

4. **Invoice number format: `INV-<fiscal year>-<6-digit sequence>`**, e.g. `INV-2026-000123`,
   as in the blueprint's example. *Gap:* the blueprint types the field `String(14)`, but its
   own example has 15 characters. The field is widened to `String(15)` rather than changing
   the documented format. The sequence restarts per fiscal year and continues from the
   highest existing number of that year. A number is assigned once, on the first successful
   Save, and kept when the invoice is edited again (even if its date moves to another year).
   *Gap:* the blueprint does not define a number range object. `@assert.unique` on
   `invoiceNumber` makes a concurrent collision fail instead of creating two equal numbers;
   a real number range (or a database sequence) is a later improvement.

5. **Fiscal year = calendar year of the invoice date**, as the blueprint specifies for the
   MVP. Company-specific fiscal year variants are out of scope.

6. **Duplicates.** D2 normalisation: upper-case; remove spaces, `-`, `/`, `.`; then strip
   leading zeros from every numeric run (separators are removed first, so `007-01` becomes
   `701`). D1 compares supplier + normalised reference + fiscal year against all
   non-cancelled invoices, excluding the invoice itself (so re-editing does not collide).
   Invoices without a status (saved before phase 3) count as non-cancelled.
   `checkDuplicates` is a read-only OData function for a live check; it is not yet wired
   into the Fiori UI (Fiori elements cannot call it while typing without custom code). D1
   on Save stays authoritative either way.

7. **Mock data.** Phase 1 had no deleted PO header, which V5 needs. MOCK PO `4500000107`
   (deleted) was added to `mock-data/s4mock`. Test-only invoices (an existing and a cancelled
   one) live in `test/data`, loaded only in the `test` profile (`cds.requires.db.data`).
