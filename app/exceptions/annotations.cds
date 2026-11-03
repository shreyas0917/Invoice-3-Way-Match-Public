/**
 * UI annotations for the Exception Worklist (Buyer, AP Manager): ExceptionService only.
 * Buyers see only BUYER-type exceptions of their purchasing group - enforced by @restrict
 * on the server, not by this UI. Invoice and match-result details use the to-one
 * navigations exception -> its own invoice / result, which stay inside the buyer's group.
 */
using ExceptionService as service from '../../srv/exception-service';

annotate service.Exceptions with @(
  UI.HeaderInfo: {
    TypeName      : 'Exception',
    TypeNamePlural: 'Exceptions',
    Title         : { Value: type },
    Description   : { Value: invoice.invoiceNumber }
  },

  UI.SelectionFields: [ type, status, purchasingGroup, responsibleRole ],

  UI.LineItem: [
    { Value: type, Criticality: typeInfo.criticality },
    { Value: invoice.invoiceNumber, Label: 'Invoice' },
    { Value: invoice.supplierName, Label: 'Supplier' },
    { Value: invoice.purchaseOrder, Label: 'Purchase Order' },
    { Value: invoice.invoiceDate, Label: 'Invoice Date' },
    { Value: varianceAmount },
    { Value: purchasingGroup },
    { Value: responsibleRole },
    { Value: status, Criticality: statusInfo.criticality },
    { Value: createdAt },
    { $Type: 'UI.DataFieldForAction', Action: 'ExceptionService.resolve', Label: 'Resolve' }
  ],

  // Largest money at stake first.
  UI.PresentationVariant: {
    SortOrder     : [{ Property: varianceAmount, Descending: true }],
    Visualizations: ['@UI.LineItem']
  },
  UI.SelectionPresentationVariant #Open: {
    Text: 'Open',
    SelectionVariant   : { SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'OPEN' }] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #All: {
    Text: 'All',
    SelectionVariant   : { SelectOptions: [] },
    PresentationVariant: ![@UI.PresentationVariant]
  },

  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#status' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#amount' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#invoiceStatus' }
  ],
  UI.DataPoint #status       : { Value: status, Title: 'Exception Status', Criticality: statusInfo.criticality },
  UI.DataPoint #amount       : { Value: varianceAmount, Title: 'Amount at Stake' },
  UI.DataPoint #invoiceStatus: { Value: invoice.status, Title: 'Invoice Status' },

  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'ExceptionService.resolve', Label: 'Resolve' }
  ],

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'Exception', Label: 'Exception', Target: '@UI.FieldGroup#Exception' },
    { $Type: 'UI.ReferenceFacet', ID: 'Invoice', Label: 'Invoice', Target: '@UI.FieldGroup#Invoice' },
    { $Type: 'UI.ReferenceFacet', ID: 'Match', Label: 'What Was Compared', Target: '@UI.FieldGroup#Match' },
    { $Type: 'UI.ReferenceFacet', ID: 'Decision', Label: 'Decision', Target: '@UI.FieldGroup#Decision' }
  ],

  UI.FieldGroup #Exception: { Data: [
    { Value: type },
    { Value: status, Criticality: statusInfo.criticality },
    { Value: responsibleRole },
    { Value: purchasingGroup },
    { Value: varianceAmount },
    { Value: invoiceItem.itemNo, Label: 'Invoice Item' },
    { Value: invoiceItem.purchaseOrderItem, Label: 'PO Item' },
    { Value: createdAt }
  ]},
  UI.FieldGroup #Invoice: { Data: [
    { Value: invoice.invoiceNumber, Label: 'Invoice Number' },
    { Value: invoice.supplierName, Label: 'Supplier' },
    { Value: invoice.supplierReference, Label: 'Supplier Reference' },
    { Value: invoice.purchaseOrder, Label: 'Purchase Order' },
    { Value: invoice.invoiceDate, Label: 'Invoice Date' },
    { Value: invoice.grossAmount, Label: 'Gross Amount' },
    { Value: invoice.status, Label: 'Invoice Status' }
  ]},
  UI.FieldGroup #Match: { Data: [
    { Value: matchResult.poQuantity, Label: 'PO Quantity' },
    { Value: matchResult.poUnitPrice, Label: 'PO Unit Price' },
    { Value: matchResult.receivedQuantity, Label: 'Received (net)' },
    { Value: matchResult.previouslyInvoicedQty, Label: 'Previously Invoiced' },
    { Value: matchResult.invoicedQuantity, Label: 'Invoiced Quantity' },
    { Value: matchResult.invoicedUnitPrice, Label: 'Invoiced Unit Price' },
    { Value: matchResult.priceVariancePct, Label: 'Price Variance %' },
    { Value: matchResult.quantityVariance, Label: 'Quantity Variance' },
    { Value: matchResult.runAt, Label: 'Matched At' }
  ]},
  UI.FieldGroup #Decision: { Data: [
    { Value: resolution },
    { Value: resolutionNote },
    { Value: resolvedBy },
    { Value: resolvedAt }
  ]}
);
