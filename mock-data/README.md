# mock-data/ - MOCK S/4HANA data

Everything in this folder is **simulated**. It imitates data that SAP S/4HANA owns
(suppliers, purchase orders, goods receipts) so the app runs on a laptop with no SAP
system. It is loaded only in the `development` and `test` profiles (see `cds.requires`
in `package.json`), is never exposed over HTTP, and is never deployed. Supplier names
start with `MOCK` so they cannot be mistaken for real data.

The app reads this data only through `ExternalPurchaseOrderService`
(`srv/external/mock-po-service.js`).

## Records and the test scenarios they support

All amounts are INR. Test IDs refer to the blueprint's test catalogue.

### Suppliers

| supplierID | Notes | Scenarios |
|---|---|---|
| 1000010 | normal, purchasing group 001 POs | M1, M2, M3, P1, P2, Q1, Q2, T1-T5, D1-D4 |
| 1000020 | normal, group 002 | M5, G1, V5 (deleted PO), buyer visibility (A1) |
| 1000030 | normal, company code 1020 | Q3, V5 |
| 1000040 | normal, country SE | M4 |
| 1000050 | **posting-blocked** | V4 (blocked supplier fails validation) |

### Purchase orders and items

| PO / item | Supplier | CoCd | PGrp | Qty | Price | priceUnit | GR-based | Goods receipts | Scenarios |
|---|---|---|---|---|---|---|---|---|---|
| 4500000101 / 00010 Office chair | 1000010 | 1010 | 001 | 50 EA | 1,500.00 | 1 | yes | 50 received | M1 clean match (under auto-release limit), M3 partial invoice, P1/P2/T1-T3 price tolerance, Q1 over-invoicing |
| 4500000101 / 00020 Desk lamp | 1000010 | 1010 | 001 | 20 EA | 800.00 | 1 | yes | 20 received | Q2 second invoice exceeds received |
| 4500000102 / 00010 Laptop | 1000010 | 1010 | 001 | 10 EA | 85,000.00 | 1 | yes | 10 received | M2 fully matched but above auto-release limit |
| 4500000103 / 00010 Copier paper | 1000020 | 1010 | 002 | 10,000 EA | 450.00 per 100 | **100** | yes | 10,000 received | M5 unit price = 4.50 |
| 4500000103 / 00020 Toner | 1000020 | 1010 | 002 | 20 EA | 3,200.00 | 1 | yes | **none** | G1 missing goods receipt |
| 4500000104 / 00010 Steel rod 12 mm | 1000030 | 1020 | 002 | 100 KG | 62.00 | 1 | yes | 100 received, then **30 reversed (102)** = net 70 | Q3 net received |
| 4500000104 / 00020 Steel rod 16 mm | 1000030 | 1020 | 002 | 50 KG | 70.00 | 1 | yes | none | V5 **deleted** PO item |
| 4500000105 / 00010 Maintenance | 1000040 | 1020 | 001 | 12 EA | 5,000.00 | 1 | **no (2-way)** | none | M4 2-way match |
| 4500000106 / 00010 Network cable | 1000050 | 1010 | 002 | 100 EA | 250.00 | 1 | yes | 100 received | V4 blocked supplier |
| 4500000107 / 00010 Copier paper A3 (**PO deleted**) | 1000020 | 1010 | 002 | 5,000 EA | 600.00 per 100 | 100 | yes | none | V5 deleted purchase order |

### Goods receipts (material documents, year 2026)

| Document | Item | PO / item | Qty | Movement |
|---|---|---|---|---|
| 5000000001 | 0001 | 4500000101 / 00010 | 50 EA | 101 |
| 5000000001 | 0002 | 4500000101 / 00020 | 20 EA | 101 |
| 5000000002 | 0001 | 4500000102 / 00010 | 10 EA | 101 |
| 5000000003 | 0001 | 4500000103 / 00010 | 10,000 EA | 101 |
| 5000000004 | 0001 | 4500000104 / 00010 | 100 KG | 101 |
| 5000000005 | 0001 | 4500000104 / 00010 | 30 KG | **102 reversal** |
| 5000000006 | 0001 | 4500000106 / 00010 | 100 EA | 101 |

## s4api/ - the same data in SAP's API shape (phase 10)

`s4api/` holds **simulated** data in the field names of the official SAP APIs
(`API_PURCHASEORDER_2`, `API_MATERIAL_DOCUMENT_SRV`, `API_BUSINESS_PARTNER`). CAP mocks those APIs
locally with it when the S/4 adapter runs without credentials (profile `s4-adapter`,
`npm run watch:s4`). Suppliers 1000010-050 and POs 4500000101-107 carry the same business facts
as `s4mock/`, so one contract test runs against both implementations. POs 4500000108-110 are
SAP-only edge cases: price per a different unit than the order unit (refused), a fully cancelled
receipt (net 25), a 122 return movement (refused).

In the public repository, `s4api/` contains only `fixtures.js` (synthetic values, and only the fields the
adapter reads) and `index.cds`. The CSVs in `s4api/data/` are generated locally by `npm run s4:fixtures`
from `fixtures.js` and your imported SAP models (every other non-nullable column gets an empty value;
unknown field names are rejected) - they are git-ignored. See `docs/sap-api-setup.md`.
