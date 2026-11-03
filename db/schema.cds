/**
 * The app's own data (namespace `ap`). S/4HANA-owned data (suppliers, POs, goods
 * receipts) is NOT modelled here: it is referenced by key only (plain String fields,
 * no CDS associations), because a local table can never be joined with a remote API.
 *
 * Current scope (phases 2-7): Invoices, InvoiceItems, ToleranceRules, ApprovalPolicies,
 * MatchResults, Exceptions, ApprovalHistory, MessageLog (model only; filled in phase 8).
 * Invoice status changes only through srv/lib/status-machine.js.
 *
 * Validation layers (phase 3):
 *  - declarative, below: @mandatory, @assert.range, @assert (single-field rules)
 *  - srv/invoice-service.js `before SAVE`: cross-field and S/4 rules V1-V10, duplicate D1
 * All message codes are defined in srv/_i18n/messages.properties.
 * Fields marked @readonly are set by backend handlers, never by users.
 */
namespace ap;

using { cuid, managed, Currency } from '@sap/cds/common';
using { ap.InvoiceStatuses, ap.ItemMatchStatuses, ap.ExceptionTypes, ap.ExceptionResolutions,
        ap.ExceptionStatuses, ap.ApprovalReasons } from './codelists';

type Amount   : Decimal(15, 2);
type Quantity : Decimal(13, 3);

@assert.unique: { invoiceNumber: [invoiceNumber] }
entity Invoices : cuid, managed {
  // INV-<fiscal year>-<6-digit sequence>, e.g. INV-2026-000123 (15 characters;
  // the blueprint's String(14) cannot hold its own example, see docs/adr/0002).
  invoiceNumber       : String(15) @readonly;
  supplierID          : String(10) @mandatory;
  supplierName        : String(80) @readonly; // snapshot at submission
  supplierReference   : String(16) @mandatory; // the supplier's own invoice number
  normalizedReference : String(16) @readonly; // duplicate-check key, see srv/lib/duplicate.js
  invoiceDate         : Date       @mandatory
                        @assert: (case when invoiceDate > $now then 'INVOICE_DATE_IN_FUTURE' end);
  fiscalYear          : String(4)  @readonly; // calendar year of invoiceDate (MVP)
  companyCode         : String(4)  @mandatory;
  purchaseOrder       : String(10) @mandatory; // one PO per invoice
  purchasingGroup     : String(3)  @readonly; // copied from the PO at submission
  currency            : Currency   @mandatory;
  netAmount           : Amount     @mandatory;
  taxAmount           : Amount     @mandatory
                        @assert.range: [0, _]   @assert.range.message: 'TAX_AMOUNT_NEGATIVE';
  grossAmount         : Amount     @mandatory
                        @assert.range: [(0), _] @assert.range.message: 'GROSS_AMOUNT_NOT_POSITIVE';
  status              : String(20) @readonly; // see InvoiceStatuses; set by the backend
  // Why an invoice waits in PENDING_APPROVAL: OVER_AUTO_RELEASE_LIMIT, NO_APPROVAL_POLICY or
  // POLICY_CURRENCY_MISMATCH (phase 4); ACCEPTED_VARIANCE follows in phase 5.
  approvalReason      : String(30) @readonly;
  approvalReasonInfo  : Association to one ApprovalReasons on approvalReasonInfo.code = approvalReason;
  blockReason         : String(255);
  lastMatchRunID      : UUID       @readonly; // runID of the latest match run
  lastMatchAt         : Timestamp  @readonly;
  items               : Composition of many InvoiceItems on items.up_ = $self;
  statusInfo          : Association to one InvoiceStatuses on statusInfo.code = status;
  matchResults        : Association to many MatchResults on matchResults.invoice = $self; // all runs
  latestMatchResults  : Association to many MatchResults on latestMatchResults.invoice = $self
                                                          and latestMatchResults.runID = lastMatchRunID;
  exceptions          : Association to many Exceptions on exceptions.invoice = $self;
  history             : Association to many ApprovalHistory on history.invoice = $self;
}

entity InvoiceItems : cuid {
  up_               : Association to Invoices;
  itemNo            : Integer    @mandatory; // 1, 2, 3... unique per invoice (V3)
  purchaseOrderItem : String(5)  @mandatory; // S/4 PO item of the invoice's PO, by key
  description       : String(40);
  quantity          : Quantity   @mandatory
                      @assert.range: [(0), _] @assert.range.message: 'ITEM_QUANTITY_NOT_POSITIVE';
  unit              : String(3)  @mandatory;
  unitPrice         : Amount     @mandatory
                      @assert.range: [(0), _] @assert.range.message: 'ITEM_UNIT_PRICE_NOT_POSITIVE';
  netAmount         : Amount     @mandatory;
  matchStatus       : String(15) @readonly default 'NOT_MATCHED';
  matchStatusInfo   : Association to one ItemMatchStatuses on matchStatusInfo.code = matchStatus;
}

/**
 * Price and quantity tolerances. Empty companyCode = global default for all company
 * codes; a company-specific rule overrides it. At most one active rule per company code
 * and variance type may be valid on any date (checked in srv/admin-service.js, because
 * overlapping date ranges cannot be expressed with @assert.unique).
 * Fields marked @changelog are tracked by @cap-js/change-tracking (see db/change-tracking.cds).
 */
entity ToleranceRules : cuid, managed {
  companyCode   : String(4)     @changelog;
  varianceType  : String(10)    @changelog @mandatory @assert.range enum {
    PRICE;
    QUANTITY;
  };
  upperPercent  : Decimal(5, 2) @changelog @mandatory
                  @assert.range: [0, 100] @assert.range.message: 'TOLERANCE_PERCENT_RANGE';
  lowerPercent  : Decimal(5, 2) @changelog @mandatory
                  @assert.range: [0, 100] @assert.range.message: 'TOLERANCE_PERCENT_RANGE';
  upperAbsolute : Amount        @changelog @mandatory
                  @assert.range: [0, _]   @assert.range.message: 'TOLERANCE_ABSOLUTE_NEGATIVE';
  lowerAbsolute : Amount        @changelog @mandatory
                  @assert.range: [0, _]   @assert.range.message: 'TOLERANCE_ABSOLUTE_NEGATIVE';
  currency      : Currency      @changelog @mandatory; // currency of the absolute limits
  validFrom     : Date          @changelog @mandatory;
  validTo       : Date          @changelog // inclusive; empty = open-ended
                  @assert: (case when validTo < validFrom then 'TOLERANCE_VALID_TO_BEFORE_FROM' end);
  isActive      : Boolean       @changelog default true;
}

/** Fully matched invoices with a gross amount above autoReleaseLimit still need AP Manager approval. */
@assert.unique: { companyCode: [companyCode] }
entity ApprovalPolicies : cuid, managed {
  companyCode      : String(4) @mandatory;
  autoReleaseLimit : Amount    @mandatory @assert.range: [0, _];
  currency         : Currency  @mandatory;
}

/**
 * Insert-only: one row per invoice item per match run. The values actually compared are
 * stored as a snapshot, so later changes in S/4 never rewrite an earlier result.
 */
entity MatchResults : cuid {
  invoice               : Association to Invoices;
  invoiceItem           : Association to InvoiceItems;
  runID                 : UUID;           // groups the rows of one match run
  runAt                 : Timestamp;
  poQuantity            : Quantity;
  poUnitPrice           : Decimal(15, 4); // netPrice / priceUnit, may need more than 2 decimals
  receivedQuantity      : Quantity;       // net GR quantity (101 - 102); 0 for 2-way items
  previouslyInvoicedQty : Quantity;       // on other non-cancelled invoices (and earlier lines)
  invoicedQuantity      : Quantity;
  invoicedUnitPrice     : Amount;
  priceVariancePct      : Decimal(11, 4); // signed
  priceVarianceAmount   : Amount;         // signed: (invoice price - PO price) x invoiced quantity
  quantityVariance      : Quantity;       // signed: invoiced - open; positive = over-invoiced
  appliedPriceRule      : Association to ToleranceRules; // empty = no rule, zero tolerance applied
  appliedQtyRule        : Association to ToleranceRules;
  result                : String(20);     // PASS or the first failure; Exceptions hold all failures
  resultInfo            : Association to one ExceptionTypes on resultInfo.code = result;
}

/** One row per failed check (item level) or suspected duplicate (header level). */
entity Exceptions : cuid, managed {
  invoice         : Association to Invoices @mandatory;
  invoiceItem     : Association to InvoiceItems; // empty for header-level (DUPLICATE_SUSPECT)
  matchResult     : Association to MatchResults;
  relatedInvoice  : Association to Invoices;     // DUPLICATE_SUSPECT: the invoice it may duplicate
  runID           : UUID       @readonly;        // the match run that raised it
  type            : String(20) @mandatory;       // PRICE_VARIANCE, QTY_VARIANCE, NO_GR, DUPLICATE_SUSPECT
  responsibleRole : String(15) @readonly;        // BUYER or AP_MANAGER
  purchasingGroup : String(3)  @readonly;        // from the PO, for row-level security (phase 6)
  varianceAmount  : Amount     @readonly;        // money at stake, for sorting
  // OPEN -> RESOLVED through the resolve action; OPEN -> SUPERSEDED when the invoice is
  // unblocked or cancelled before the exception was decided (a new match decides afresh).
  status          : String(10) @readonly default 'OPEN';
  resolution      : String(10) @readonly;        // ACCEPT, REMATCH, REJECT - set only by resolve
  resolutionNote  : String(500) @readonly;
  resolvedBy      : String(255) @readonly;
  resolvedAt      : Timestamp   @readonly;
  typeInfo        : Association to one ExceptionTypes on typeInfo.code = type;
  resolutionInfo  : Association to one ExceptionResolutions on resolutionInfo.code = resolution;
  statusInfo      : Association to one ExceptionStatuses on statusInfo.code = status;
}

/**
 * Insert-only business decision log: who did what to an invoice, from which status to
 * which, and why. One row per status action, written in the same transaction as the
 * action (srv/lib/history.js). No service exposes it for writing.
 */
entity ApprovalHistory : cuid {
  invoice    : Association to Invoices;
  exception  : Association to Exceptions; // RESOLVE only
  action     : String(15); // SUBMIT, MATCH, RESOLVE, APPROVE, REJECT, RELEASE, BLOCK, UNBLOCK, CANCEL
  fromStatus : String(20); // empty for the first SUBMIT
  toStatus   : String(20);
  actor      : String(255);
  actorRole  : String(15);
  comment    : String(500);
  at         : Timestamp;
}

// Optimistic concurrency: OData ETags from modifiedAt. A request with a stale If-Match
// header gets 412 instead of silently overwriting someone else's change.
annotate Invoices with { modifiedAt @odata.etag };
annotate Exceptions with { modifiedAt @odata.etag };

/**
 * Insert-only technical log of calls to the S/4 facade (blueprint "MessageLog").
 * Phase 7 adds only the model, so the Integration Log app can bind to it; it stays empty
 * until phase 8 writes one row per facade call (separate transaction, correlation ID).
 * Never stores credentials or full payloads.
 */
entity MessageLog : cuid {
  createdAt     : Timestamp @cds.on.insert: $now;
  correlationID : UUID;        // one per user request; ties log lines together
  direction     : String(3);   // OUT (MVP), IN (future)
  targetSystem  : String(20);  // S4_MOCK locally, S4 later - never blur these
  operation     : String(60);  // e.g. getPurchaseOrder
  invoice       : Association to Invoices;
  status        : String(10);  // SUCCESS, FAILED
  durationMs    : Integer;
  errorMessage  : String(1000);
}
