/**
 * Field-level change history (@cap-js/change-tracking). The plugin generates database
 * triggers from these annotations, so every write to a tracked field is recorded in
 * sap.changelog.Changes - also writes made by backend handlers. This is the field-change
 * audit trail; business decisions with reasons are recorded in ApprovalHistory.
 * Entity-level paths give each record a readable object ID.
 */
using { ap } from './schema';

annotate ap.Invoices with @changelog: [invoiceNumber] {
  supplierID        @changelog;
  supplierReference @changelog;
  invoiceDate       @changelog;
  companyCode       @changelog;
  purchaseOrder     @changelog;
  netAmount         @changelog;
  taxAmount         @changelog;
  grossAmount       @changelog;
  status            @changelog;
  approvalReason    @changelog;
  blockReason       @changelog;
}

annotate ap.Exceptions with @changelog: [type, invoice.invoiceNumber] {
  status         @changelog;
  resolution     @changelog;
  resolutionNote @changelog;
  resolvedBy     @changelog;
}

annotate ap.ToleranceRules with @changelog: [varianceType, companyCode];
