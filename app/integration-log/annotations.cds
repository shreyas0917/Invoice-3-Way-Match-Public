/**
 * UI annotations for the Integration Log (AP Manager): AdminService.MessageLog, read-only.
 * One row per call to S/4HANA through the facade (phase 8), newest first. Payloads and
 * credentials are never stored or shown; nothing here is invented - an empty log is shown
 * as empty (webapp/i18n).
 */
using AdminService as service from '../../srv/admin-service';

annotate service.MessageLog with @(
  UI.HeaderInfo: {
    TypeName      : 'Integration Call',
    TypeNamePlural: 'Integration Calls',
    Title         : { Value: operation },
    Description   : { Value: createdAt }
  },

  UI.SelectionFields: [ status, operation, targetSystem, createdAt, correlationID ],

  UI.LineItem: [
    { Value: createdAt },
    { Value: status, Criticality: statusCriticality },
    { Value: operation },
    { Value: invoice.invoiceNumber, Label: 'Invoice' },
    { Value: durationMs },
    { Value: errorMessage },
    { Value: correlationID },
    { Value: targetSystem },
    { Value: direction },
    { Value: invoice_ID }
  ],

  UI.PresentationVariant: {
    SortOrder     : [{ Property: createdAt, Descending: true }],
    Visualizations: ['@UI.LineItem']
  }
);
