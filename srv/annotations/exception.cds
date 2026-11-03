/**
 * Shared annotations for ExceptionService: labels, texts, value helps and the resolve dialog.
 * UI layout lives in app/exceptions/annotations.cds. No association is added here: phase 6
 * removed every navigation that could step outside the buyer restriction (ADR 0005).
 */
using ExceptionService as service from '../exception-service';

annotate service.Exceptions with @title: 'Exception' {
  ID              @UI.Hidden;
  invoice         @title: 'Invoice' @Common.Text: invoice.invoiceNumber @Common.TextArrangement: #TextOnly;
  invoiceItem     @title: 'Invoice Item';
  matchResult     @title: 'Match Result';
  relatedInvoice  @title: 'Possible Duplicate Of';
  runID           @UI.Hidden;
  type            @title: 'Type' @Common.Text: typeInfo.name @Common.TextArrangement: #TextOnly
                  @Common.ValueListWithFixedValues @Common.ValueList: {
                    CollectionPath: 'ExceptionTypes',
                    Parameters    : [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: type, ValueListProperty: 'code' } ]
                  };
  responsibleRole @title: 'Responsible';
  purchasingGroup @title: 'Purchasing Group';
  varianceAmount  @title: 'Amount at Stake' @Measures.ISOCurrency: invoice.currency_code;
  status          @title: 'Status' @Common.Text: statusInfo.name @Common.TextArrangement: #TextOnly
                  @Common.ValueListWithFixedValues @Common.ValueList: {
                    CollectionPath: 'ExceptionStatuses',
                    Parameters    : [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: status, ValueListProperty: 'code' } ]
                  };
  resolution      @title: 'Resolution' @Common.Text: resolutionInfo.name @Common.TextArrangement: #TextOnly;
  resolutionNote  @title: 'Resolution Note';
  resolvedBy      @title: 'Resolved By';
  resolvedAt      @title: 'Resolved At';
  createdAt       @title: 'Raised At';
  createdBy       @title: 'Raised By (match run)';
}

annotate service.ExceptionTypes with { code @Common.Text: name @Common.TextArrangement: #TextOnly; }
annotate service.ExceptionStatuses with { code @Common.Text: name @Common.TextArrangement: #TextOnly; }
annotate service.AllowedResolutions with @title: 'Resolution' {
  resolution    @title: 'Resolution' @Common.Text: name @Common.TextArrangement: #TextOnly;
  exceptionType @title: 'Exception Type';
  name          @title: 'Resolution';
}

// Resolve: only for OPEN exceptions; the dropdown lists the resolutions allowed for this
// exception's type (AllowedResolutions, filtered by in/type). The backend validates again.
annotate service.Exceptions actions {
  resolve @(
    Core.OperationAvailable: { $edmJson: { $Eq: [ { $Path: 'in/status' }, 'OPEN' ] } },
    Common.SideEffects     : {
      TargetProperties: [ 'in/status', 'in/resolution', 'in/resolutionNote', 'in/resolvedBy', 'in/resolvedAt' ],
      TargetEntities  : [ 'in/invoice' ]
    }
  ) (
    resolution @title: 'Resolution' @Common.ValueListWithFixedValues @Common.ValueList: {
      CollectionPath: 'AllowedResolutions',
      Parameters    : [
        { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: resolution, ValueListProperty: 'resolution' },
        { $Type: 'Common.ValueListParameterIn', LocalDataProperty: in.type, ValueListProperty: 'exceptionType' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
      ]
    },
    note @title: 'Note (required): why this decision is right; it is kept in the audit history' @UI.MultiLineText
  );
}

// Read-only context, shown on the exception's object page.
annotate service.Invoices with @title: 'Invoice' {
  invoiceNumber     @title: 'Invoice Number';
  supplierName      @title: 'Supplier';
  supplierReference @title: 'Supplier Reference';
  purchaseOrder     @title: 'Purchase Order';
  invoiceDate       @title: 'Invoice Date';
  grossAmount       @title: 'Gross Amount' @Measures.ISOCurrency: currency_code;
  currency          @title: 'Currency';
  status            @title: 'Invoice Status' @Common.Text: statusInfo.name @Common.TextArrangement: #TextOnly;
}

annotate service.MatchResults with @title: 'Match Result' {
  poQuantity            @title: 'PO Quantity';
  poUnitPrice           @title: 'PO Unit Price';
  receivedQuantity      @title: 'Received (net)';
  previouslyInvoicedQty @title: 'Previously Invoiced';
  invoicedQuantity      @title: 'Invoiced Quantity';
  invoicedUnitPrice     @title: 'Invoiced Unit Price';
  priceVariancePct      @title: 'Price Variance %';
  priceVarianceAmount   @title: 'Price Variance Amount';
  quantityVariance      @title: 'Quantity Variance';
  result                @title: 'Result';
  runAt                 @title: 'Matched At';
}

annotate service.InvoiceItems with {
  itemNo            @title: 'Item';
  purchaseOrderItem @title: 'PO Item';
  description       @title: 'Description';
}
