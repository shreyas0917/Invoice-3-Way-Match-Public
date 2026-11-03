/**
 * MOCK - simulated SAP S/4HANA data.
 *
 * These entities imitate data that S/4HANA owns (suppliers, purchase orders,
 * goods receipts). They exist only so the app can run on a laptop. They are
 * loaded in the development and test profiles only, are never exposed over
 * HTTP, and are never deployed. Field lengths follow S/4 conventions so a
 * later mapping to the real APIs is straightforward.
 */
namespace s4mock;

using { Currency } from '@sap/cds/common';

entity Suppliers {
  key supplierID       : String(10);
      name             : String(80);
      country          : String(3);
      isPostingBlocked : Boolean default false;
}

entity PurchaseOrders {
  key purchaseOrder   : String(10);
      supplier        : Association to Suppliers;
      companyCode     : String(4);
      purchasingGroup : String(3);
      currency        : Currency;
      orderDate       : Date;
      isDeleted       : Boolean default false;
      items           : Composition of many PurchaseOrderItems on items.up_ = $self;
}

entity PurchaseOrderItems {
  key up_           : Association to PurchaseOrders;
  key item          : String(5);
      material      : String(40);
      description   : String(40);
      orderQuantity : Decimal(13, 3);
      orderUnit     : String(3);
      netPrice      : Decimal(15, 2); // price per `priceUnit` units
      priceUnit     : Decimal(5, 0) default 1; // unit price = netPrice / priceUnit
      grBasedIV     : Boolean default true; // true = 3-way match, false = 2-way
      isDeleted     : Boolean default false;
}

entity GoodsReceipts {
  key materialDocument     : String(10);
  key materialDocumentYear : String(4);
      postingDate          : Date;
      items                : Composition of many GoodsReceiptItems on items.up_ = $self;
}

entity GoodsReceiptItems {
  key up_               : Association to GoodsReceipts;
  key item              : String(4);
      purchaseOrder     : String(10);
      purchaseOrderItem : String(5);
      quantity          : Decimal(13, 3); // always positive; the movement type gives the sign
      unit              : String(3);
      movementType      : String(3) @assert.range enum {
        receipt  = '101';
        reversal = '102';
      };
}
