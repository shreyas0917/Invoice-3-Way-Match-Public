/**
 * UI annotations for the Invoice Workbench (AP Clerk, AP Manager): List Report + Object Page.
 * Labels, value helps and action availability are shared and live in srv/annotations/invoice.cds.
 */
using InvoiceService as service from '../../srv/invoice-service';

annotate service.Invoices with @(
  UI.HeaderInfo: {
    TypeName      : 'Invoice',
    TypeNamePlural: 'Invoices',
    Title         : { Value: supplierReference },
    Description   : { Value: invoiceNumber } // generated on the first successful save
  },

  UI.SelectionFields: [ status, supplierID, companyCode, purchaseOrder, invoiceDate ],

  UI.LineItem: [
    { Value: invoiceNumber },
    { Value: supplierName },
    { Value: supplierReference },
    { Value: purchaseOrder },
    { Value: grossAmount },
    { Value: status, Criticality: statusInfo.criticality },
    { Value: invoiceDate },
    { Value: createdBy, Label: 'Created By' }
  ],

  UI.PresentationVariant: {
    SortOrder     : [{ Property: invoiceDate, Descending: true }],
    Visualizations: ['@UI.LineItem']
  },

  // Status tabs of the list report (manifest "views", with counts).
  UI.SelectionPresentationVariant #All: {
    Text: 'All',
    SelectionVariant   : { SelectOptions: [] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #Open: {
    Text: 'Open',
    SelectionVariant: { SelectOptions: [{ PropertyName: status, Ranges: [
      { Sign: #I, Option: #EQ, Low: 'VALIDATED' },
      { Sign: #I, Option: #EQ, Low: 'MATCHED' },
      { Sign: #I, Option: #EQ, Low: 'EXCEPTION' },
      { Sign: #I, Option: #EQ, Low: 'PENDING_APPROVAL' },
      { Sign: #I, Option: #EQ, Low: 'BLOCKED' }
    ] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #Validated: {
    Text: 'Validated',
    SelectionVariant: { SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'VALIDATED' }] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #Exception: {
    Text: 'Exception',
    SelectionVariant: { SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'EXCEPTION' }] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #PendingApproval: {
    Text: 'Pending Approval',
    SelectionVariant: { SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'PENDING_APPROVAL' }] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #Blocked: {
    Text: 'Blocked',
    SelectionVariant: { SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'BLOCKED' }] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.SelectionPresentationVariant #Released: {
    Text: 'Released',
    SelectionVariant: { SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'RELEASED' }] }] },
    PresentationVariant: ![@UI.PresentationVariant]
  },

  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#number' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#supplier' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#status' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#gross' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#atStake' }
  ],
  UI.DataPoint #number  : { Value: invoiceNumber, Title: 'Invoice Number' },
  UI.DataPoint #supplier: { Value: supplierName, Title: 'Supplier' },
  UI.DataPoint #status  : { Value: status, Title: 'Status', Criticality: statusInfo.criticality },
  UI.DataPoint #gross   : { Value: grossAmount, Title: 'Gross Amount' },
  UI.DataPoint #atStake : { Value: moneyAtStake, Title: 'Money at Stake (open exceptions)' },

  // Action buttons in the object page header; each is enabled only in the statuses where
  // the status machine allows it (see srv/annotations/invoice.cds). Role checks are in the backend.
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.match',   Label: 'Match' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.release', Label: 'Release' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.approve', Label: 'Approve' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.reject',  Label: 'Reject' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.block',   Label: 'Block' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.unblock', Label: 'Unblock' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.cancel',  Label: 'Cancel Invoice' }
  ],

  // The Change History section is added by @cap-js/change-tracking.
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'General', Label: 'General', Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', ID: 'Amounts', Label: 'Amounts', Target: '@UI.FieldGroup#Amounts' },
    { $Type: 'UI.ReferenceFacet', ID: 'Items',   Label: 'Items',   Target: 'items/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'Matching', Label: 'Matching Results (latest run)', Target: 'latestMatchResults/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'Exceptions', Label: 'Exceptions', Target: 'exceptions/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'History', Label: 'Approval History', Target: 'history/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'Admin',   Label: 'Administrative', Target: '@UI.FieldGroup#Admin' }
  ],

  // Read-only fields (invoice number, snapshots, fiscal year, status) are filled on Save.
  UI.FieldGroup #General: { Data: [
    { Value: supplierID },
    { Value: supplierName },
    { Value: supplierReference },
    { Value: invoiceDate },
    { Value: fiscalYear },
    { Value: purchaseOrder },
    { Value: purchasingGroup },
    { Value: companyCode },
    { Value: invoiceNumber },
    { Value: status, Criticality: statusInfo.criticality },
    { Value: approvalReason },
    { Value: blockReason },
    { Value: lastMatchAt }
  ]},

  UI.FieldGroup #Amounts: { Data: [
    { Value: currency_code },
    { Value: netAmount },
    { Value: taxAmount },
    { Value: grossAmount },
    { Value: moneyAtStake }
  ]},

  UI.FieldGroup #Admin: { Data: [
    { Value: createdBy, Label: 'Created By' },
    { Value: createdAt, Label: 'Created At' },
    { Value: modifiedBy, Label: 'Changed By' },
    { Value: modifiedAt, Label: 'Changed At' }
  ]}
);

annotate service.InvoiceItems with @(
  UI.HeaderInfo: {
    TypeName      : 'Item',
    TypeNamePlural: 'Items',
    Title         : { Value: itemNo },
    Description   : { Value: description }
  },
  UI.PresentationVariant: {
    SortOrder     : [{ Property: itemNo }],
    Visualizations: ['@UI.LineItem']
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'ItemDetails', Label: 'Item Details', Target: '@UI.FieldGroup#ItemDetails' }
  ],
  UI.FieldGroup #ItemDetails: { Data: [
    { Value: itemNo },
    { Value: purchaseOrderItem },
    { Value: description },
    { Value: quantity },
    { Value: unit },
    { Value: unitPrice },
    { Value: netAmount },
    { Value: matchStatus, Criticality: matchStatusInfo.criticality }
  ]},
  UI.LineItem: [
    { Value: itemNo },
    { Value: purchaseOrderItem },
    { Value: description },
    { Value: quantity },
    { Value: unit },
    { Value: unitPrice },
    { Value: netAmount },
    { Value: matchStatus, Criticality: matchStatusInfo.criticality }
  ]
);

// What the engine compared, per item, in the latest run (older runs stay in matchResults).
annotate service.MatchResults with @(
  UI.PresentationVariant: {
    SortOrder     : [{ Property: invoiceItem_ID }],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem: [
    { Value: invoiceItem.itemNo, Label: 'Item' },
    { Value: invoiceItem.purchaseOrderItem, Label: 'PO Item' },
    { Value: poQuantity },
    { Value: poUnitPrice },
    { Value: receivedQuantity },
    { Value: previouslyInvoicedQty },
    { Value: invoicedQuantity },
    { Value: invoicedUnitPrice },
    { Value: priceVariancePct },
    { Value: priceVarianceAmount },
    { Value: quantityVariance },
    { Value: priceRuleText },
    { Value: qtyRuleText },
    { Value: result, Criticality: resultInfo.criticality }
  ]
);

annotate service.Exceptions with @(
  UI.PresentationVariant: {
    SortOrder     : [{ Property: varianceAmount, Descending: true }], // largest money at risk first
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem: [
    { Value: type, Criticality: typeInfo.criticality },
    { Value: invoiceItem.itemNo, Label: 'Item' },
    { Value: status, Criticality: statusInfo.criticality },
    { Value: responsibleRole },
    { Value: purchasingGroup },
    { Value: varianceAmount },
    { Value: relatedInvoice.invoiceNumber, Label: 'Possible Duplicate Of' },
    { Value: resolution },
    { Value: resolutionNote },
    { Value: resolvedBy },
    { Value: resolvedAt }
  ]
);

// Business decisions, newest first.
annotate service.ApprovalHistory with @(
  UI.PresentationVariant: {
    SortOrder     : [{ Property: at, Descending: true }],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem: [
    { Value: at },
    { Value: action },
    { Value: fromStatus },
    { Value: toStatus },
    { Value: actor },
    { Value: actorRole },
    { Value: comment }
  ]
);
