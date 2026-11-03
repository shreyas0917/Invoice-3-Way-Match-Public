using { ap } from '../db/schema';

/**
 * AdminService - matching configuration and the integration log, served at /odata/v4/admin.
 *
 * Authorization (phase 6): AP Manager only, on the service and again on each entity
 * (defence in depth, so a new entity is never exposed to other roles by accident).
 */
@requires: 'APManager'
service AdminService {

  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'APManager' }]
  entity ToleranceRules   as projection on ap.ToleranceRules {
    *,
    /** How rules are applied - a fixed explanation shown on the object page (computed on read). */
    virtual null as howRulesApply : String(500)
  };

  @restrict: [{ grant: '*', to: 'APManager' }]
  entity ApprovalPolicies as projection on ap.ApprovalPolicies;

  /**
   * Integration Log: read-only for AP Managers. One row per call through the S/4 facade,
   * written by the facade guard (srv/external/facade-guard.js) - never by OData, never seeded.
   * Search covers correlation ID, operation and error text.
   */
  @readonly
  @restrict: [{ grant: 'READ', to: 'APManager' }]
  @cds.search: { correlationID, operation, errorMessage }
  entity MessageLog       as projection on ap.MessageLog {
    *,
    invoice : redirected to InvoiceRefs,
    /** 1 (red) for FAILED, 3 (green) for SUCCESS - for the UI only. */
    case when status = 'FAILED' then 1 else 3 end as statusCriticality : Integer
  };

  /**
   * Just enough of an invoice to name it in the Integration Log: ID and number, nothing else.
   * A failed first submission logs the draft's ID, which has no saved invoice (yet).
   */
  @readonly
  @cds.redirection.target: false
  @restrict: [{ grant: 'READ', to: 'APManager' }]
  entity InvoiceRefs      as projection on ap.Invoices { key ID, invoiceNumber };

  @readonly
  @restrict: [{ grant: 'READ', to: 'APManager' }]
  entity VarianceTypes    as projection on ap.VarianceTypes;
}

// Shared labels and value helps.
using from './annotations/admin';
