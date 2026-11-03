/**
 * SYNTHETIC test data for the local CAP mocks of the SAP APIs (profile s4-adapter). All values are
 * invented for this project; nothing comes from a real SAP system.
 *
 * Only the fields the S/4 adapter reads (srv/external/s4-adapter.js: SUPPLIER_FIELDS,
 * PO_HEADER_FIELDS, PO_ITEM_FIELDS, MOVEMENT_FIELDS) plus the keys are listed. The CSV files the
 * mocks load are NOT in the repository: `npm run s4:fixtures` generates them into ./data from this
 * file and your locally imported SAP models (docs/sap-api-setup.md); it fills every other
 * non-nullable column of those models with an empty value ('', 0, false).
 *
 * POs 4500000101-107 and suppliers 1000010-050 hold the SAME business facts as the facade mock
 * (mock-data/s4mock), so both implementations run one contract test. POs 4500000108-110 are
 * SAP-only edge cases the adapter must handle.
 */
const po = (PurchaseOrder, Supplier, CompanyCode, PurchasingGroup, PurchaseOrderDate, PurchaseOrderDeletionCode = '') =>
  ({ PurchaseOrder, Supplier, CompanyCode, PurchasingGroup, DocumentCurrency: 'INR', PurchaseOrderDate, PurchaseOrderDeletionCode })

const item = (PurchaseOrder, PurchaseOrderItem, Material, PurchaseOrderItemText, OrderQuantity, unit, NetPriceAmount,
  NetPriceQuantity = 1, { gr = true, deletion = '', priceUnit = unit } = {}) =>
  ({ PurchaseOrder, PurchaseOrderItem, Material, PurchaseOrderItemText, OrderQuantity, PurchaseOrderQuantityUnit: unit,
    NetPriceAmount, NetPriceQuantity, OrderPriceUnit: priceUnit, InvoiceIsGoodsReceiptBased: gr,
    PurchasingDocumentDeletionCode: deletion })

/** One material document item. 101 = goods receipt, 102 = reversal of a receipt. */
const movement = (MaterialDocument, MaterialDocumentItem, GoodsMovementType, PurchaseOrder, PurchaseOrderItem, quantity, unit) => ({
  MaterialDocumentYear: '2026', MaterialDocument, MaterialDocumentItem, GoodsMovementType, PurchaseOrder, PurchaseOrderItem,
  QuantityInEntryUnit: quantity, EntryUnit: unit, QuantityInBaseUnit: quantity, MaterialBaseUnit: unit
})

module.exports = {
  'API_BUSINESS_PARTNER.A_Supplier': [
    { Supplier: '1000010', SupplierName: 'MOCK Acme Industrial Supplies', PostingIsBlocked: false },
    { Supplier: '1000020', SupplierName: 'MOCK Bharat Office Products', PostingIsBlocked: false },
    { Supplier: '1000030', SupplierName: 'MOCK Deccan Steel Traders', PostingIsBlocked: false },
    { Supplier: '1000040', SupplierName: 'MOCK Nordic Lab Services', PostingIsBlocked: false },
    { Supplier: '1000050', SupplierName: 'MOCK Blocked Trading Co', PostingIsBlocked: true }
  ],

  'API_PURCHASEORDER_2.PurchaseOrder': [
    po('4500000101', '1000010', '1010', '001', '2026-09-01'),
    po('4500000102', '1000010', '1010', '001', '2026-09-05'),
    po('4500000103', '1000020', '1010', '002', '2026-09-10'),
    po('4500000104', '1000030', '1020', '002', '2026-09-15'),
    po('4500000105', '1000040', '1020', '001', '2026-09-20'),
    po('4500000106', '1000050', '1010', '002', '2026-09-25'),
    po('4500000107', '1000020', '1010', '002', '2026-09-30', 'L'), // deleted PO
    // SAP-only edge cases
    po('4500000108', '1000030', '1020', '002', '2026-10-01'), // price per KG, ordered in EA
    po('4500000109', '1000040', '1010', '001', '2026-10-02'), // cancelled receipt
    po('4500000110', '1000040', '1010', '001', '2026-10-03') // return delivery (122)
  ],

  'API_PURCHASEORDER_2.PurchaseOrderItem': [
    item('4500000101', '00010', 'MAT-CHAIR-01', 'Office chair', 50, 'EA', 1500),
    item('4500000101', '00020', 'MAT-LAMP-01', 'Desk lamp', 20, 'EA', 800),
    item('4500000102', '00010', 'MAT-LAPTOP-01', 'Laptop 14 inch', 10, 'EA', 85000),
    item('4500000103', '00010', 'MAT-PAPER-A4', 'Copier paper A4 sheet', 10000, 'EA', 450, 100), // 450 per 100 sheets
    item('4500000103', '00020', 'MAT-TONER-01', 'Toner cartridge', 20, 'EA', 3200),
    item('4500000104', '00010', 'MAT-STEEL-12', 'Steel rod 12 mm', 100, 'KG', 62),
    item('4500000104', '00020', 'MAT-STEEL-16', 'Steel rod 16 mm', 50, 'KG', 70, 1, { deletion: 'L' }),
    item('4500000105', '00010', 'SRV-MAINT-01', 'Lab equipment maintenance', 12, 'EA', 5000, 1, { gr: false }),
    item('4500000106', '00010', 'MAT-CABLE-01', 'Network cable 5 m', 100, 'EA', 250),
    item('4500000107', '00010', 'MAT-PAPER-A3', 'Copier paper A3 sheet', 5000, 'EA', 600, 100),
    item('4500000108', '00010', 'MAT-WIRE-01', 'Copper wire spool', 10, 'EA', 900, 1, { priceUnit: 'KG' }),
    item('4500000109', '00010', 'MAT-CHAIR-01', 'Office chair', 40, 'EA', 1500),
    item('4500000110', '00010', 'MAT-LAMP-01', 'Desk lamp', 30, 'EA', 800)
  ],

  'API_MATERIAL_DOCUMENT.A_MaterialDocumentItem': [
    movement('5000000001', '0001', '101', '4500000101', '00010', 50, 'EA'),
    movement('5000000001', '0002', '101', '4500000101', '00020', 20, 'EA'),
    movement('5000000002', '0001', '101', '4500000102', '00010', 10, 'EA'),
    movement('5000000003', '0001', '101', '4500000103', '00010', 10000, 'EA'),
    movement('5000000004', '0001', '101', '4500000104', '00010', 100, 'KG'),
    movement('5000000005', '0001', '102', '4500000104', '00010', 30, 'KG'), // partial reversal of 5000000004
    movement('5000000006', '0001', '101', '4500000106', '00010', 100, 'EA'),
    // 4500000109: a receipt of 40 cancelled completely (in SAP: the 101 is flagged as cancelled and
    // a 102 document reverses it - the adapter counts both, so they cancel out), then 25 received
    movement('5000000007', '0001', '101', '4500000109', '00010', 40, 'EA'),
    movement('5000000008', '0001', '102', '4500000109', '00010', 40, 'EA'),
    movement('5000000009', '0001', '101', '4500000109', '00010', 25, 'EA'),
    // 4500000110: 30 received, 5 returned to the supplier (122) - not supported, must not be ignored
    movement('5000000010', '0001', '101', '4500000110', '00010', 30, 'EA'),
    movement('5000000011', '0001', '122', '4500000110', '00010', 5, 'EA')
  ]
}
