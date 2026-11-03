using { ExternalPurchaseOrderService as S4 } from './external/purchase-order-facade';

/**
 * MatchingEngine - internal service, never reachable over HTTP (@protocol: 'none').
 *
 * Pure decision logic: InvoiceService gathers the data (invoice, PO and goods receipts
 * through ExternalPurchaseOrderService, local invoice quantities, rules, policy) and
 * calls evaluate(); the engine returns verdicts and writes nothing. The calculation
 * itself lives in srv/lib/matching.js so it can also be unit-tested without CAP.
 */
@protocol: 'none'
service MatchingEngine {

  type InvoiceItemInput {
    ID                : UUID;
    itemNo            : Integer;
    purchaseOrderItem : String(5);
    quantity          : Decimal(13, 3);
    unitPrice         : Decimal(15, 2);
  }

  type InvoiceInput {
    ID                  : UUID;
    companyCode         : String(4);
    currency_code       : String(3);
    invoiceDate         : Date;
    grossAmount         : Decimal(15, 2);
    normalizedReference : String(16);
    items               : many InvoiceItemInput;
  }

  type InvoicedQuantity {
    purchaseOrderItem : String(5);
    quantity          : Decimal(13, 3);
  }

  type ToleranceRule {
    ID            : UUID;
    companyCode   : String(4);
    varianceType  : String(10);
    upperPercent  : Decimal(5, 2);
    lowerPercent  : Decimal(5, 2);
    upperAbsolute : Decimal(15, 2);
    lowerAbsolute : Decimal(15, 2);
    currency_code : String(3);
    validFrom     : Date;
    validTo       : Date;
    isActive      : Boolean;
  }

  type ApprovalPolicy {
    companyCode      : String(4);
    autoReleaseLimit : Decimal(15, 2);
    currency_code    : String(3);
  }

  type PossibleDuplicate {
    ID                  : UUID;
    invoiceNumber       : String(15);
    normalizedReference : String(16);
    grossAmount         : Decimal(15, 2);
  }

  type ItemVerdict {
    invoiceItemID         : UUID;
    result                : String(20);
    matchStatus           : String(15);
    poQuantity            : Decimal(13, 3);
    poUnitPrice           : Decimal(15, 4);
    receivedQuantity      : Decimal(13, 3);
    previouslyInvoicedQty : Decimal(13, 3);
    invoicedQuantity      : Decimal(13, 3);
    invoicedUnitPrice     : Decimal(15, 2);
    priceVariancePct      : Decimal(11, 4);
    priceVarianceAmount   : Decimal(15, 2);
    quantityVariance      : Decimal(13, 3);
    appliedPriceRuleID    : UUID;
    appliedQtyRuleID      : UUID;
  }

  type ExceptionVerdict {
    type             : String(20);
    responsibleRole  : String(15);
    invoiceItemID    : UUID; // empty for header-level exceptions
    relatedInvoiceID : UUID; // DUPLICATE_SUSPECT only
    purchasingGroup  : String(3);
    varianceAmount   : Decimal(15, 2);
  }

  type Message {
    code : String(60);
    args : many String;
  }

  type Evaluation {
    items      : many ItemVerdict;
    exceptions : many ExceptionVerdict;
    outcome    : {
      status         : String(20); // MATCHED, PENDING_APPROVAL or EXCEPTION
      approvalReason : String(30);
    };
    warnings   : many Message;
  }

  /** Evaluates one invoice against its PO and goods receipts. Reads and writes nothing. */
  function evaluate(
    invoice            : InvoiceInput,
    purchaseOrder      : S4.PurchaseOrder,
    receivedQuantities : many S4.ReceivedQuantity,
    invoicedQuantities : many InvoicedQuantity, // on other non-cancelled invoices
    toleranceRules     : many ToleranceRule,
    approvalPolicy     : ApprovalPolicy,
    possibleDuplicates : many PossibleDuplicate // same supplier and date, not cancelled
  ) returns Evaluation;
}
