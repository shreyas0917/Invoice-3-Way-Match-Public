/**
 * Shared annotations for InvoiceService: labels, texts, currencies/units and value helps.
 * UI layout (columns, facets) lives in app/invoices/annotations.cds.
 */
using InvoiceService as service from '../invoice-service';

// --- Labels and display semantics ---------------------------------------------

annotate service.Invoices with @title: 'Invoice' {
  ID                  @title: 'Invoice ID'  @UI.Hidden;
  invoiceNumber       @title: 'Invoice Number';
  supplierID          @title: 'Supplier';
  supplierName        @title: 'Supplier Name';
  supplierReference   @title: 'Supplier Reference';
  normalizedReference @title: 'Normalized Reference' @UI.Hidden;
  invoiceDate         @title: 'Invoice Date';
  fiscalYear          @title: 'Fiscal Year';
  companyCode         @title: 'Company Code';
  purchaseOrder       @title: 'Purchase Order';
  purchasingGroup     @title: 'Purchasing Group';
  currency            @title: 'Currency';
  netAmount           @title: 'Net Amount'   @Measures.ISOCurrency: currency_code;
  taxAmount           @title: 'Tax Amount'   @Measures.ISOCurrency: currency_code;
  grossAmount         @title: 'Gross Amount' @Measures.ISOCurrency: currency_code;
  status              @title: 'Status'
                      @Common.Text: statusInfo.name  @Common.TextArrangement: #TextOnly;
  approvalReason      @title: 'Approval Reason';
  blockReason         @title: 'Block Reason';
  lastMatchRunID      @title: 'Last Match Run' @UI.Hidden;
  lastMatchAt         @title: 'Last Matched At';
}

// Required reasons/comments are checked by the handlers (stable codes REASON_REQUIRED and
// COMMENT_REQUIRED, shown in the dialog); @Common.FieldControl: #Mandatory on the parameters
// would make CAP answer first with its generic ASSERT_MANDATORY instead.
// Status actions. Buttons are enabled only in the statuses where srv/lib/status-machine.js
// allows the action - a UI convenience; the backend enforces the same table regardless.
// After an action the page reloads the status fields, items, results, exceptions and history.
annotate service.Invoices actions {
  match @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'VALIDATED' ] } },
    Common.SideEffects     : {
      TargetProperties: [ 'in/status', 'in/approvalReason', 'in/blockReason', 'in/lastMatchAt' ],
      TargetEntities  : [ 'in/items', 'in/latestMatchResults', 'in/exceptions', 'in/history' ]
    }
  );
  release @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'MATCHED' ] } },
    Common.SideEffects     : { TargetProperties: [ 'in/status' ], TargetEntities: [ 'in/history' ] }
  );
  approve @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'PENDING_APPROVAL' ] } },
    Common.SideEffects     : { TargetProperties: [ 'in/status', 'in/approvalReason' ], TargetEntities: [ 'in/history' ] }
  ) (comment @title: 'Comment' @UI.MultiLineText);
  reject @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'PENDING_APPROVAL' ] } },
    Common.SideEffects     : { TargetProperties: [ 'in/status', 'in/approvalReason', 'in/blockReason' ], TargetEntities: [ 'in/history' ] }
  ) (reason @title: 'Reason (required): why the invoice is rejected' @UI.MultiLineText);
  block @(
    Core.OperationAvailable: { $edmJson: { $Or: [
      { $Eq: [ { $Path: 'in/status' }, 'VALIDATED' ] },
      { $Eq: [ { $Path: 'in/status' }, 'MATCHED' ] },
      { $Eq: [ { $Path: 'in/status' }, 'EXCEPTION' ] },
      { $Eq: [ { $Path: 'in/status' }, 'PENDING_APPROVAL' ] }
    ] } },
    Common.SideEffects     : { TargetProperties: [ 'in/status', 'in/approvalReason', 'in/blockReason' ], TargetEntities: [ 'in/history' ] }
  ) (reason @title: 'Reason (required): why payment is stopped' @UI.MultiLineText);
  unblock @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'BLOCKED' ] } },
    Common.SideEffects     : {
      TargetProperties: [ 'in/status', 'in/blockReason' ],
      TargetEntities  : [ 'in/items', 'in/latestMatchResults', 'in/exceptions', 'in/history' ]
    }
  ) (comment @title: 'Comment (required); a fresh match will be needed' @UI.MultiLineText);
  cancel @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'BLOCKED' ] } },
    Common.SideEffects     : { TargetProperties: [ 'in/status' ], TargetEntities: [ 'in/exceptions', 'in/history' ] }
  ) (reason @title: 'Reason (required); cancelling is final' @UI.MultiLineText);
}

annotate service.ApprovalHistory with @title: 'Approval History' {
  ID         @UI.Hidden;
  invoice    @UI.Hidden;
  exception  @title: 'Exception';
  action     @title: 'Action';
  fromStatus @title: 'From Status';
  toStatus   @title: 'To Status';
  actor      @title: 'By';
  actorRole  @title: 'Role';
  comment    @title: 'Comment / Reason';
  at         @title: 'At';
}

annotate service.MatchResults with @title: 'Match Result' {
  ID                    @UI.Hidden;
  invoice               @UI.Hidden;
  invoiceItem           @title: 'Invoice Item';
  runID                 @title: 'Run';
  runAt                 @title: 'Matched At';
  poQuantity            @title: 'PO Quantity';
  poUnitPrice           @title: 'PO Unit Price';
  receivedQuantity      @title: 'Received (net)';
  previouslyInvoicedQty @title: 'Previously Invoiced';
  invoicedQuantity      @title: 'Invoiced Quantity';
  invoicedUnitPrice     @title: 'Invoiced Unit Price';
  priceVariancePct      @title: 'Price Variance %';
  priceVarianceAmount   @title: 'Price Variance Amount';
  quantityVariance      @title: 'Quantity Variance';
  appliedPriceRule      @title: 'Price Rule';
  appliedQtyRule        @title: 'Quantity Rule';
  result                @title: 'Result'
                        @Common.Text: resultInfo.name  @Common.TextArrangement: #TextOnly;
}

annotate service.Exceptions with @title: 'Exception' {
  ID              @UI.Hidden;
  invoice         @UI.Hidden;
  invoiceItem     @title: 'Invoice Item';
  matchResult     @title: 'Match Result';
  relatedInvoice  @title: 'Possible Duplicate Of';
  type            @title: 'Type'
                  @Common.Text: typeInfo.name  @Common.TextArrangement: #TextOnly;
  responsibleRole @title: 'Responsible';
  purchasingGroup @title: 'Purchasing Group';
  varianceAmount  @title: 'Amount at Stake';
  status          @title: 'Status';
  resolution      @title: 'Resolution';
  resolutionNote  @title: 'Resolution Note';
  resolvedBy      @title: 'Resolved By';
  resolvedAt      @title: 'Resolved At';
}

annotate service.ToleranceRules with @title: 'Tolerance Rule' {
  companyCode   @title: 'Company Code';
  varianceType  @title: 'Variance Type';
  upperPercent  @title: 'Upper %';
  lowerPercent  @title: 'Lower %';
  upperAbsolute @title: 'Upper Absolute';
  lowerAbsolute @title: 'Lower Absolute';
  validFrom     @title: 'Valid From';
  validTo       @title: 'Valid To';
  isActive      @title: 'Active';
}

annotate service.InvoiceItems with @title: 'Invoice Item' {
  ID                @UI.Hidden;
  up_               @UI.Hidden;
  itemNo            @title: 'Item';
  purchaseOrderItem @title: 'PO Item';
  description       @title: 'Description';
  quantity          @title: 'Quantity'   @Measures.Unit: unit;
  unit              @title: 'Unit';
  unitPrice         @title: 'Unit Price' @Measures.ISOCurrency: currency_code;
  netAmount         @title: 'Net Amount' @Measures.ISOCurrency: currency_code;
  currency_code     @title: 'Currency' @Core.Computed;
  matchStatus       @title: 'Match Status'
                    @Common.Text: matchStatusInfo.name  @Common.TextArrangement: #TextOnly;
}

annotate service.Suppliers with @title: 'Supplier (S/4, via facade)' {
  supplierID       @title: 'Supplier'  @Common.Text: name  @Common.TextArrangement: #TextFirst;
  name             @title: 'Name';
  country          @title: 'Country';
  isPostingBlocked @title: 'Posting Blocked';
}

annotate service.PurchaseOrders with @title: 'Purchase Order (S/4, via facade)' {
  purchaseOrder   @title: 'Purchase Order';
  supplierID      @title: 'Supplier';
  companyCode     @title: 'Company Code';
  purchasingGroup @title: 'Purchasing Group';
  currency_code   @title: 'Currency';
  orderDate       @title: 'Order Date';
  isDeleted       @title: 'Deleted';
}

annotate service.PurchaseOrderItems with @title: 'PO Item (S/4, via facade)' {
  purchaseOrder @title: 'Purchase Order';
  item          @title: 'PO Item';
  material      @title: 'Material';
  description   @title: 'Description';
  orderQuantity @title: 'Order Quantity';
  orderUnit     @title: 'Unit';
  netPrice      @title: 'Net Price';
  priceUnit     @title: 'Price Unit';
  unitPrice     @title: 'Unit Price';
  grBasedIV     @title: 'GR-Based IV';
  isDeleted     @title: 'Deleted';
}

// --- Value helps (all backed by ExternalPurchaseOrderService) --------------------

annotate service.Invoices with {
  supplierID @Common.ValueList: {
    Label         : 'Suppliers',
    CollectionPath: 'Suppliers',
    Parameters    : [
      { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: supplierID, ValueListProperty: 'supplierID' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'country' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'isPostingBlocked' }
    ]
  };

  // Choosing a PO filters by the chosen supplier (if any) and fills supplier,
  // company code and currency from the PO.
  purchaseOrder @Common.ValueList: {
    Label         : 'Purchase Orders',
    CollectionPath: 'PurchaseOrders',
    Parameters    : [
      { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: purchaseOrder, ValueListProperty: 'purchaseOrder' },
      { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: supplierID,    ValueListProperty: 'supplierID' },
      { $Type: 'Common.ValueListParameterOut',         LocalDataProperty: companyCode,   ValueListProperty: 'companyCode' },
      { $Type: 'Common.ValueListParameterOut',         LocalDataProperty: currency_code, ValueListProperty: 'currency_code' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'purchasingGroup' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'orderDate' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'isDeleted' }
    ]
  };
}

annotate service.InvoiceItems with {
  // Lists the items of the invoice's PO (header field up_/purchaseOrder) and
  // pre-fills description, unit and the PO unit price as a hint.
  purchaseOrderItem @Common.ValueList: {
    Label         : 'PO Items',
    CollectionPath: 'PurchaseOrderItems',
    Parameters    : [
      { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: purchaseOrderItem,  ValueListProperty: 'item' },
      { $Type: 'Common.ValueListParameterIn',          LocalDataProperty: up_.purchaseOrder,  ValueListProperty: 'purchaseOrder' },
      { $Type: 'Common.ValueListParameterOut',         LocalDataProperty: description,        ValueListProperty: 'description' },
      { $Type: 'Common.ValueListParameterOut',         LocalDataProperty: unit,               ValueListProperty: 'orderUnit' },
      { $Type: 'Common.ValueListParameterOut',         LocalDataProperty: unitPrice,          ValueListProperty: 'unitPrice' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'material' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'orderQuantity' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'isDeleted' }
    ]
  };
}

// --- Phase 7: list filters, computed fields, edit/delete buttons -----------------------

annotate service.Invoices with @(
  // Edit (a new draft) only while VALIDATED, as the backend allows; submitted invoices are
  // never deleted. Both are enforced in the handlers as well.
  UI.UpdateHidden: { $edmJson: { $Ne: [ { $Path: 'status' }, 'VALIDATED' ] } },
  UI.DeleteHidden: true,
  // Invoice date filter as a date range
  Capabilities.FilterRestrictions: {
    FilterExpressionRestrictions: [ { Property: invoiceDate, AllowedExpressions: 'SingleRange' } ]
  }
) {
  moneyAtStake   @title: 'Money at Stake' @Measures.ISOCurrency: currency_code @Core.Computed;
  approvalReason @Common.Text: approvalReasonInfo.name @Common.TextArrangement: #TextOnly;
  status         @Common.ValueListWithFixedValues @Common.ValueList: {
    CollectionPath: 'InvoiceStatuses',
    Parameters    : [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: status, ValueListProperty: 'code' } ]
  };
}

annotate service.InvoiceStatuses with { code @Common.Text: name @Common.TextArrangement: #TextOnly; }
annotate service.ApprovalReasons with { code @Common.Text: name @Common.TextArrangement: #TextOnly; }

annotate service.MatchResults with {
  priceRuleText @title: 'Price Rule Applied' @Core.Computed;
  qtyRuleText   @title: 'Quantity Rule Applied' @Core.Computed;
}

annotate service.Exceptions with {
  status @Common.Text: statusInfo.name @Common.TextArrangement: #TextOnly;
}

// --- Approval Queue (AP Manager) ----------------------------------------------------------

annotate service.ApprovalQueue with @title: 'Invoice Awaiting Approval' {
  ID                  @UI.Hidden;
  invoiceNumber       @title: 'Invoice Number';
  supplierID          @title: 'Supplier';
  supplierName        @title: 'Supplier Name';
  supplierReference   @title: 'Supplier Reference';
  invoiceDate         @title: 'Invoice Date';
  companyCode         @title: 'Company Code';
  purchaseOrder       @title: 'Purchase Order';
  purchasingGroup     @title: 'Purchasing Group';
  currency            @title: 'Currency';
  grossAmount         @title: 'Gross Amount'   @Measures.ISOCurrency: currency_code;
  netAmount           @title: 'Net Amount'     @Measures.ISOCurrency: currency_code;
  taxAmount           @title: 'Tax Amount'     @Measures.ISOCurrency: currency_code;
  moneyAtStake        @title: 'Money at Stake' @Measures.ISOCurrency: currency_code @Core.Computed;
  status              @title: 'Status' @Common.Text: statusInfo.name @Common.TextArrangement: #TextOnly;
  approvalReason      @title: 'Why Approval Is Needed'
                      @Common.Text: approvalReasonInfo.name @Common.TextArrangement: #TextOnly;
  normalizedReference @UI.Hidden;
  lastMatchRunID      @UI.Hidden;
  lastMatchAt         @title: 'Last Matched At';
  blockReason         @title: 'Block Reason';
  fiscalYear          @title: 'Fiscal Year';
}

// After a decision the invoice leaves the queue (the action returns nothing), so the whole
// queue is reloaded rather than the row.
annotate service.ApprovalQueue actions {
  approve @(
    Common.SideEffects: { TargetEntities: [ '/InvoiceService.EntityContainer/ApprovalQueue' ] }
  ) (comment @title: 'Comment (optional): recorded in the approval history' @UI.MultiLineText);
  reject @(
    Common.SideEffects: { TargetEntities: [ '/InvoiceService.EntityContainer/ApprovalQueue' ] }
  ) (reason @title: 'Reason (required): why the invoice is rejected - it becomes the block reason' @UI.MultiLineText);
  block @(
    Common.SideEffects: { TargetEntities: [ '/InvoiceService.EntityContainer/ApprovalQueue' ] }
  ) (reason @title: 'Reason (required): why payment is stopped' @UI.MultiLineText);
}

annotate service.Exceptions with { varianceAmount @Measures.ISOCurrency: invoice.currency_code; }

annotate service.ApprovalQueue with {
  approvalReason @Common.ValueListWithFixedValues @Common.ValueList: {
    CollectionPath: 'ApprovalReasons',
    Parameters    : [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: approvalReason, ValueListProperty: 'code' } ]
  };
}
