using { ap } from '../db/schema';

/**
 * ExceptionService - exception worklist and resolution, served at /odata/v4/exception.
 *
 * Authorization (phase 6, blueprint role matrix). Everything is read-only; the only
 * write is the resolve action.
 *   service       Buyer and AP Manager only
 *   AP Manager    reads everything, resolves every exception type
 *   Buyer         reads and resolves only BUYER-type exceptions (PRICE_VARIANCE,
 *                 QTY_VARIANCE, NO_GR) of their own purchasing group ($user.purchasingGroup);
 *                 reads only invoices, items, match results and history of that group;
 *                 never sees DUPLICATE_SUSPECT (responsibleRole AP_MANAGER)
 * A buyer without a purchasingGroup attribute sees nothing: CAP evaluates an undefined
 * $user attribute as "no match".
 */
@requires: ['Buyer', 'APManager']
service ExceptionService {

  @readonly // changed only through resolve
  @restrict: [
    { grant: ['READ', 'resolve'], to: 'APManager' },
    { grant: ['READ', 'resolve'], to: 'Buyer',
      where: 'purchasingGroup = $user.purchasingGroup and responsibleRole = ''BUYER''' }
  ]
  entity Exceptions as projection on ap.Exceptions actions {
    /**
     * Decides an OPEN exception: ACCEPT (pay despite the variance; for a suspected
     * duplicate: not a duplicate), REMATCH (data corrected at the source) or REJECT.
     * The note is mandatory. Deciding the last open exception recomputes the invoice.
     */
    action resolve(resolution : String(10), note : String(500)) returns Exceptions;
  };

  // CAP applies a target's instance restriction to requests on that entity set, but not
  // to rows reached by $expand or navigation from another entity. Associations that could
  // lead from a visible row to hidden rows (e.g. an own-group invoice -> its AP_MANAGER
  // duplicate exception) are therefore not exposed here; buyers reach exceptions, results
  // and history through the restricted entity sets above and below.
  @readonly
  @restrict: [
    { grant: 'READ', to: 'APManager' },
    { grant: 'READ', to: 'Buyer', where: 'purchasingGroup = $user.purchasingGroup' }
  ]
  entity Invoices             as projection on ap.Invoices excluding { exceptions, matchResults, latestMatchResults, history };

  @readonly
  @restrict: [
    { grant: 'READ', to: 'APManager' },
    { grant: 'READ', to: 'Buyer', where: 'up_.purchasingGroup = $user.purchasingGroup' }
  ]
  entity InvoiceItems         as projection on ap.InvoiceItems;

  @readonly
  @restrict: [
    { grant: 'READ', to: 'APManager' },
    { grant: 'READ', to: 'Buyer', where: 'invoice.purchasingGroup = $user.purchasingGroup' }
  ]
  entity MatchResults         as projection on ap.MatchResults;

  @readonly
  @restrict: [
    { grant: 'READ', to: 'APManager' },
    { grant: 'READ', to: 'Buyer', where: 'invoice.purchasingGroup = $user.purchasingGroup' }
  ]
  entity ApprovalHistory      as projection on ap.ApprovalHistory excluding { exception }; // see Invoices

  // Configuration and code lists: not group-specific.
  @readonly
  entity ToleranceRules       as projection on ap.ToleranceRules;

  @readonly
  entity ExceptionTypes       as projection on ap.ExceptionTypes;

  @readonly
  entity ExceptionResolutions as projection on ap.ExceptionResolutions;

  @readonly
  entity InvoiceStatuses      as projection on ap.InvoiceStatuses;

  @readonly
  entity ItemMatchStatuses    as projection on ap.ItemMatchStatuses;

  @readonly
  entity ExceptionStatuses    as projection on ap.ExceptionStatuses;

  /**
   * Value help of the resolve dialog: which resolution fits which exception type. Served
   * from srv/lib/status-machine.js (RESOLUTIONS_BY_TYPE), the same table resolve checks,
   * so the dialog and the backend can never disagree. No table (@cds.persistence.skip).
   */
  @readonly @cds.persistence.skip
  entity AllowedResolutions {
    key exceptionType : String(20);
    key resolution    : String(10);
        name          : String(255);
  }
}


// The change-tracking plugin would add a ChangeView with the field changes of ALL invoices
// and exceptions to this service; it cannot be restricted by purchasing group. So it is
// not generated here. Buyers see decisions in the group-restricted ApprovalHistory; the
// full change history stays in InvoiceService (AP Clerk, AP Manager) and AdminService.
annotate ExceptionService.Exceptions     with @changelog.disable_assoc;
annotate ExceptionService.Invoices       with @changelog.disable_assoc;
annotate ExceptionService.ToleranceRules with @changelog.disable_assoc;

// Shared labels, value helps and the resolve dialog.
using from './annotations/exception';
