# ADR 0004 - Status machine, exception resolution and audit

- Status: accepted
- Date: 2026-11-02
- Phase: 5

## Decisions

1. **One transition table, one writer.** `srv/lib/status-machine.js` holds the table
   (SUBMIT, MATCH, RESOLVE, RELEASE, APPROVE, REJECT, BLOCK, UNBLOCK, CANCEL) and
   `transition()`, the only code that updates `Invoices.status`. It validates the move (409
   `INVALID_STATUS_TRANSITION`), updates the row guarded by the expected old status (a
   concurrent change cannot be overwritten), and writes the ApprovalHistory row - all in the
   caller's transaction. The one exception is the first status on Save: CAP's draft
   activation writes the invoice row itself, so the SAVE handler takes the value from
   `targetStatus('SUBMIT', ...)` and writes the SUBMIT history row with `srv/lib/history.js`.
   MatchingEngine and `statusAfterResolution()` only *propose* a result; `transition()`
   checks it against the table before writing.

2. **Side fields follow the status.** `approvalReason` is kept only in PENDING_APPROVAL;
   `blockReason` in BLOCKED (and CANCELLED, for context). Returning to VALIDATED (UNBLOCK,
   all-REMATCH) clears `lastMatchRunID` and resets item match statuses, so old results are
   never shown as current; every run stays in MatchResults for audit.

3. **Exceptions belong to a match run** (`Exceptions.runID`, new). "Last open exception" and
   the REJECT > ACCEPT > REMATCH recomputation consider only the invoice's current run.
   Without this, a REJECT from an earlier round would block the invoice again after
   unblock and rematch.

4. **SUPERSEDED exceptions (blueprint gap).** The blueprint knows OPEN and RESOLVED only.
   When an invoice is unblocked or cancelled while exceptions are still open, those can no
   longer be decided (resolve requires the invoice in EXCEPTION) and would stay open forever.
   They are set to `SUPERSEDED` (resolvedBy/At filled, resolution empty): a new match decides
   afresh, or the invoice is closed.

5. **Edit and delete.** A submitted invoice can be edited (new draft) only in VALIDATED (S3);
   active invoices are never deleted (409 `ACTIVE_INVOICE_NOT_DELETABLE`), drafts can be
   discarded. Status actions on a draft are refused (409 `SAVED_INVOICE_REQUIRED`).

6. **Segregation of duties:** `approve` rejects the invoice's creator (403
   `SOD_SELF_APPROVAL`), whatever their role. Role checks per action follow in phase 6; until
   then any authenticated user can call every action (temporary).

7. **Two audit trails.** ApprovalHistory = business decisions with reasons (insert-only,
   read-only in every service). `@cap-js/change-tracking` 2.2 = field-level changes on
   Invoices, Exceptions and ToleranceRules (`db/change-tracking.cds`). The plugin works with
   database triggers, so backend writes (status changes) are recorded too, with the user;
   verified against SQLite in `test/service/status-audit.test.js` (H1).

8. **ETags** on Invoices and Exceptions (`modifiedAt`). CAP requires `If-Match` on every write
   to such an entity (428 without it; 412 when stale). Fiori sends it automatically. The
   service tests of phases 2-4 send `If-Match: *` by default (one line per file); no
   assertion changed.

9. **Mandatory reasons are checked in the handlers** with stable codes `REASON_REQUIRED` /
   `COMMENT_REQUIRED`. `@Common.FieldControl: #Mandatory` on the action parameters was tried
   and removed: CAP then answers first with its generic `ASSERT_MANDATORY`.

10. **Known CAP warning.** The blueprint's action names `reject` and `resolve` collide with
    method names of CAP's service base class, so CAP logs "conflicts with method in base
    class" at start-up and does not generate typed convenience methods for them. OData calls
    and `srv.send('reject', ...)` are unaffected.
