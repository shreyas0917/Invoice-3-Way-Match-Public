/**
 * UI annotations for the Approval Queue (AP Manager): InvoiceService.ApprovalQueue, which
 * the server fixes to status PENDING_APPROVAL. Approve, reject and block run the same
 * handlers, status machine and segregation-of-duties check as in the Invoice Workbench.
 */
using InvoiceService as service from '../../srv/invoice-service';

annotate service.ApprovalQueue with @(
  UI.HeaderInfo: {
    TypeName      : 'Invoice Awaiting Approval',
    TypeNamePlural: 'Invoices Awaiting Approval',
    Title         : { Value: invoiceNumber },
    Description   : { Value: supplierName }
  },

  UI.SelectionFields: [ approvalReason, supplierID, companyCode, invoiceDate ],

  UI.LineItem: [
    { Value: invoiceNumber },
    { Value: supplierName },
    { Value: supplierReference },
    { Value: purchaseOrder },
    { Value: grossAmount },
    { Value: moneyAtStake },
    { Value: approvalReason, Criticality: #Critical },
    { Value: invoiceDate },
    { Value: createdBy, Label: 'Created By' },
    // Row actions in the table toolbar; enabled for the selected invoice.
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.approve', Label: 'Approve' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.reject',  Label: 'Reject' }
  ],

  UI.PresentationVariant: {
    SortOrder     : [{ Property: grossAmount, Descending: true }], // largest first
    Visualizations: ['@UI.LineItem']
  },

  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#reason' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#gross' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#atStake' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#creator' }
  ],
  UI.DataPoint #reason : { Value: approvalReason, Title: 'Why Approval Is Needed', Criticality: #Critical },
  UI.DataPoint #gross  : { Value: grossAmount, Title: 'Gross Amount' },
  UI.DataPoint #atStake: { Value: moneyAtStake, Title: 'Money at Stake' },
  UI.DataPoint #creator: { Value: createdBy, Title: 'Entered By (cannot approve)' },

  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.approve', Label: 'Approve' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.reject',  Label: 'Reject' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.block',   Label: 'Block' }
  ],

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'General', Label: 'Invoice', Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', ID: 'Matching', Label: 'Matching Results (latest run)', Target: 'latestMatchResults/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'Exceptions', Label: 'Exceptions and Decisions', Target: 'exceptions/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'History', Label: 'Approval History', Target: 'history/@UI.LineItem' }
  ],

  UI.FieldGroup #General: { Data: [
    { Value: invoiceNumber },
    { Value: supplierID },
    { Value: supplierName },
    { Value: supplierReference },
    { Value: invoiceDate },
    { Value: purchaseOrder },
    { Value: purchasingGroup },
    { Value: companyCode },
    { Value: netAmount },
    { Value: taxAmount },
    { Value: grossAmount },
    { Value: moneyAtStake },
    { Value: approvalReason },
    { Value: lastMatchAt },
    { Value: createdBy, Label: 'Entered By' }
  ]}
);
