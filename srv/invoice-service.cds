using { ap } from '../db/schema';

/**
 * InvoiceService - the AP Clerk's API, served at /odata/v4/invoice.
 *
 * Phase 2: draft-enabled invoice entry plus read-only value helps.
 * Phase 3: submission validation on Save; checkDuplicates.
 * Phase 4: the match action, with read-only match results and exceptions.
 * Phase 5: status actions.
 *
 * Authorization (phase 6, blueprint role matrix):
 *   service      AP Clerk and AP Manager only; Buyers work in ExceptionService
 *   Invoices     READ both; WRITE (create/edit/save drafts) AP Clerk only;
 *                match, release, block both; approve, reject, unblock, cancel AP Manager only
 *   everything else is read-only for both roles
 * Segregation of duties (creator cannot approve) is checked in the approve handler,
 * because it compares two values of the same record, which a role check cannot express.
 */
@requires: ['APClerk', 'APManager']
service InvoiceService {

  @odata.draft.enabled
  @restrict: [
    { grant: 'READ',  to: ['APClerk', 'APManager'] },
    // CREATE/UPDATE/DELETE: new draft (NEW), edit (EDIT) and Save write the active row;
    // DELETE of a submitted invoice is refused by the handler (cancel instead).
    { grant: 'WRITE', to: 'APClerk' },
    { grant: ['match', 'release', 'block'], to: ['APClerk', 'APManager'] },
    { grant: ['approve', 'reject', 'unblock', 'cancel'], to: 'APManager' }
  ]
  entity Invoices          as projection on ap.Invoices {
    *,
    /** Sum of the variance amounts of the open exceptions (computed on read). */
    virtual null as moneyAtStake : Decimal(15, 2)
  } actions {
    /**
     * 3-way match of a VALIDATED invoice against the current PO and goods receipts.
     * Result: MATCHED, PENDING_APPROVAL (over the auto-release limit) or EXCEPTION.
     */
    action match() returns Invoices;

    // Status actions (phase 5). Allowed statuses: srv/lib/status-machine.js.
    /** MATCHED -> RELEASED (cleared for payment). */
    action release() returns Invoices;
    /** PENDING_APPROVAL -> RELEASED; not by the invoice's creator. */
    action approve(comment : String(500)) returns Invoices;
    /** PENDING_APPROVAL -> BLOCKED; reason required. */
    action reject(reason : String(255)) returns Invoices;
    /** VALIDATED, MATCHED, EXCEPTION, PENDING_APPROVAL -> BLOCKED; reason required. */
    action block(reason : String(255)) returns Invoices;
    /** BLOCKED -> VALIDATED, ready for a fresh match; comment required. */
    action unblock(comment : String(500)) returns Invoices;
    /** BLOCKED -> CANCELLED (final); reason required. */
    action cancel(reason : String(255)) returns Invoices;
  };

  /**
   * Approval Queue (phase 7): the invoices waiting for an AP Manager, fixed on the server
   * to status PENDING_APPROVAL - not a UI filter that a client could remove. Read-only;
   * approve, reject and block use the same handlers and status machine as on Invoices.
   * Never the target of an association (@cds.redirection.target: false).
   */
  @readonly
  @cds.redirection.target: false
  @restrict: [{ grant: ['READ', 'approve', 'reject', 'block'], to: 'APManager' }]
  entity ApprovalQueue     as projection on ap.Invoices {
    *,
    virtual null as moneyAtStake : Decimal(15, 2),
    // backlinks of Invoices, re-pointed from Invoices to this projection by key
    exceptions         : redirected to Exceptions on exceptions.invoice.ID = ID,
    history            : redirected to ApprovalHistory on history.invoice.ID = ID,
    latestMatchResults : redirected to MatchResults on latestMatchResults.invoice.ID = ID
                                                    and latestMatchResults.runID = lastMatchRunID
  } excluding { items, matchResults } where status = 'PENDING_APPROVAL' actions {
    /** PENDING_APPROVAL -> RELEASED; not by the invoice's creator. */
    action approve(comment : String(500)) returns ApprovalQueue;
    /** PENDING_APPROVAL -> BLOCKED; reason required. */
    action reject(reason : String(255)) returns ApprovalQueue;
    /** PENDING_APPROVAL -> BLOCKED; reason required. */
    action block(reason : String(255)) returns ApprovalQueue;
  };

  /** Business decision log, read-only (written only by the backend). */
  @readonly
  entity ApprovalHistory   as projection on ap.ApprovalHistory;

  entity InvoiceItems      as projection on ap.InvoiceItems {
    *,
    /**
     * The invoice's currency, read-only (computed on read) so that item amounts can show it.
     * Annotating the amounts with up_.currency_code instead makes Fiori offer an editable
     * currency field on every item row that cannot be saved through the parent.
     */
    virtual null as currency_code : String(3)
  };

  @readonly
  entity MatchResults      as projection on ap.MatchResults {
    *,
    /** Readable description of the applied rules, e.g. "Global: +2.00 % / -5.00 %, 500.00 / 500.00 INR". */
    virtual null as priceRuleText : String(120),
    virtual null as qtyRuleText   : String(120)
  };

  @readonly
  entity Exceptions        as projection on ap.Exceptions;

  @readonly
  entity ToleranceRules    as projection on ap.ToleranceRules; // to show which rule was applied

  @readonly
  entity InvoiceStatuses   as projection on ap.InvoiceStatuses;

  @readonly
  entity ItemMatchStatuses as projection on ap.ItemMatchStatuses;

  @readonly
  entity ExceptionTypes    as projection on ap.ExceptionTypes;

  @readonly
  entity ExceptionResolutions as projection on ap.ExceptionResolutions;

  @readonly
  entity ExceptionStatuses as projection on ap.ExceptionStatuses;

  @readonly
  entity ApprovalReasons   as projection on ap.ApprovalReasons;

  /** A submitted invoice that may duplicate the one being entered. */
  type DuplicateCandidate {
    ID                : UUID;
    invoiceNumber     : String(15);
    supplierReference : String(16);
    invoiceDate       : Date;
    grossAmount       : Decimal(15, 2);
    currency_code     : String(3);
    status            : String(20);
    // SAME_REFERENCE: same normalised reference and fiscal year -> saving will be blocked (D1)
    // SAME_DATE_AND_AMOUNT: different reference but same date and gross amount -> check it
    reason            : String(20);
  }

  /**
   * Read-only live check for the draft UI. Uses the same normalisation as the hard D1
   * block on save, which stays in force regardless of this function. Cancelled
   * invoices are never returned.
   */
  function checkDuplicates(supplierID : String(10), supplierReference : String(16),
                           invoiceDate : Date, grossAmount : Decimal(15, 2)) returns many DuplicateCandidate;

  /*
   * Value helps for S/4HANA-owned data. These entities have no database table
   * (@cds.persistence.skip): every READ is answered by srv/invoice-service.js through
   * ExternalPurchaseOrderService, so InvoiceService never touches the s4mock tables.
   */

  @readonly @cds.persistence.skip
  entity Suppliers {
    key supplierID       : String(10);
        name             : String(80);
        country          : String(3);
        isPostingBlocked : Boolean;
  }

  @readonly @cds.persistence.skip
  entity PurchaseOrders {
    key purchaseOrder   : String(10);
        supplierID      : String(10);
        companyCode     : String(4);
        purchasingGroup : String(3);
        currency_code   : String(3);
        orderDate       : Date;
        isDeleted       : Boolean;
  }

  @readonly @cds.persistence.skip
  entity PurchaseOrderItems {
    key purchaseOrder : String(10);
    key item          : String(5);
        material      : String(40);
        description   : String(40);
        orderQuantity : Decimal(13, 3);
        orderUnit     : String(3);
        netPrice      : Decimal(15, 2);
        priceUnit     : Decimal(5, 0);
        unitPrice     : Decimal(15, 2); // netPrice / priceUnit, offered as a hint
        grBasedIV     : Boolean;
        isDeleted     : Boolean;
  }
}

// Shared labels and value helps (kept in a separate file, loaded with the service).
using from './annotations/invoice';
