# test/data - purpose-built test fixtures

Loaded only in the `test` profile (`cds.requires.db.data` in package.json), never by `cds watch`
and never deployed. Kept separate from `mock-data/` (demo data) so changing the demo
never breaks tests. CSVs here are loaded **in addition** to `db/data` and `mock-data`.

## Submitted invoices (phase 3)

| Invoice | Supplier | Reference (normalised) | FY | Status | Used by |
|---|---|---|---|---|---|
| INV-2026-000001 | 1000010 | INV-0045 (INV45) | 2026 | VALIDATED | D1/D2 exact-duplicate block, checkDuplicates, invoice numbering continues at 000002+ |
| INV-2026-000002 | 1000010 | CXL-0007 (CXL7) | 2026 | CANCELLED | D4 cancelled invoice does not block resubmission |
| INV-2025-000001 | 1000010 | SOD-0001 (SOD1) | 2025 | PENDING_APPROVAL, **created by manager1** | A4 / SoD: an AP Manager cannot approve their own invoice (AP Managers cannot create invoices through the API, so it is a fixture; fiscal year 2025 keeps the 2026 numbering of other tests unchanged) |

## MOCK S/4 test purchase orders (phase 4, `s4mock-*.csv`)

Test-only additions to the simulated S/4 data, read through ExternalPurchaseOrderService
like all S/4 data. Default tolerances from `db/data`: price +2 % / 500, -5 % / 500;
quantity 0 % / 0; auto-release limit 1,00,000 INR.

| PO / item | Supplier, CoCd | Qty | Price | priceUnit | GR-based | Net received | Scenarios |
|---|---|---|---|---|---|---|---|
| 4500000901 / 00010 widget | 1000020, 1010 | 100 EA | 1,000.00 | 1 | yes | 100 | M1, M3, P1, P2, T1-T3, T5, Q1, multiple exceptions |
| 4500000901 / 00020 panel | 1000020, 1010 | 10 EA | 25,000.00 | 1 | yes | 10 | M2 (10 x 25,000 = 2,50,000 > limit) |
| 4500000901 / 00030 bolt | 1000020, 1010 | 1,000 EA | 15,000.00 per 100 | 100 | yes | 1,000 | M5 (unit price 150) |
| 4500000901 / 00040 service | 1000020, 1010 | 50 EA | 200.00 | 1 | **no (2-way)** | none | M4 |
| 4500000901 / 00050 cable | 1000020, 1010 | 20 EA | 500.00 | 1 | yes | **none** | G1 |
| 4500000901 / 00060 rod | 1000020, 1010 | 100 EA | 500.00 | 1 | yes | 100 - 30 (102) = **70** | Q3 |
| 4500000901 / 00070 lamp | 1000020, 1010 | 20 EA | 800.00 | 1 | yes | 20 | Q2 |
| 4500000902 / 00010 plate | 1000030, 1020 | 100 EA | 1,000.00 | 1 | yes | 100 | T4 |

## Tolerance rules (phase 4, `ap-ToleranceRules.csv`)

| Rule | Company | Type | Limits | Valid | Active | Used by |
|---|---|---|---|---|---|---|
| c...01 | 1020 | PRICE | +/-10 % / 5,000 | 2026-01-01 - open | yes | T4 company rule overrides global |
| c...02 | 1010 | PRICE | +/-10 % / 5,000 | 2025-01-01 - 2025-12-31 | yes | T5 expired, global applies |
| c...03 | 1010 | QUANTITY | +50 % / 1,00,000 | 2026-01-01 - open | **no** | inactive rules are ignored |
