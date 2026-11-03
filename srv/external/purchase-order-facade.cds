/**
 * ExternalPurchaseOrderService - the ONLY door to S/4HANA data (anti-corruption layer).
 *
 * The contract below is ours, in plain business terms. Which implementation runs is
 * chosen by configuration (cds.requires.ExternalPurchaseOrderService.impl):
 *   - development / test: srv/external/mock-po-service.js (MOCK, reads s4mock tables)
 *   - profile s4-adapter / production: srv/external/s4-adapter.js over the official SAP APIs
 *     (phase 10; local CAP mocks of those APIs until phase 11 connects a real system)
 *
 * @protocol: 'none'   -> never reachable over HTTP, only in-process
 * @cds.serve.ignore   -> not started by `cds serve all`; callers obtain it with
 *                        cds.connect.to('ExternalPurchaseOrderService'), which honours
 *                        the configured impl
 */
@protocol: 'none'
@cds.serve.ignore
service ExternalPurchaseOrderService {

  type Supplier {
    supplierID       : String(10);
    name             : String(80);
    country          : String(3);
    isPostingBlocked : Boolean;
  }

  type PurchaseOrderItem {
    purchaseOrder : String(10);
    item          : String(5);
    material      : String(40);
    description   : String(40);
    orderQuantity : Decimal(13, 3);
    orderUnit     : String(3);
    netPrice      : Decimal(15, 2);
    priceUnit     : Decimal(5, 0);
    grBasedIV     : Boolean;
    isDeleted     : Boolean;
  }

  type PurchaseOrder {
    purchaseOrder   : String(10);
    supplierID      : String(10);
    companyCode     : String(4);
    purchasingGroup : String(3);
    currency        : String(3);
    orderDate       : Date;
    isDeleted       : Boolean;
    items           : many PurchaseOrderItem;
  }

  type ReceivedQuantity {
    purchaseOrder     : String(10);
    purchaseOrderItem : String(5);
    receivedQuantity  : Decimal(13, 3); // net = sum(101) - sum(102)
    unit              : String(3);
  }

  /** One supplier by ID; rejects with 404 SUPPLIER_NOT_FOUND if unknown. */
  function getSupplier(supplierID : String(10))            returns Supplier;

  /** PO header with all items; rejects with 404 PO_NOT_FOUND if unknown. */
  function getPurchaseOrder(purchaseOrder : String(10))    returns PurchaseOrder;

  /** Net received quantity per PO item (0 for items without goods receipt). */
  function getReceivedQuantities(purchaseOrder : String(10)) returns many ReceivedQuantity;

  /** Value help: suppliers whose ID or name contains the text (all if empty). */
  function searchSuppliers(text : String)                   returns many Supplier;

  /** Value help: POs whose number contains the text, optionally only those of one supplier.
      Header fields only (items stay empty); deleted POs are included and flagged. */
  function searchPurchaseOrders(text : String, supplierID : String(10)) returns many PurchaseOrder;

  /** Value help: the items of one PO; rejects with 404 PO_NOT_FOUND if unknown. */
  function listPurchaseOrderItems(purchaseOrder : String(10)) returns many PurchaseOrderItem;
}
