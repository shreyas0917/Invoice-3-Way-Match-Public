# ADR 0007 - Integration hardening (MessageLog, timeout, R2)

- Status: accepted
- Date: 2026-11-03
- Phase: 8

## Decisions

1. **One guard for every S/4 call, enforced by type.** `FacadeService`
   (`srv/external/facade-service.js`) installs `facade-guard.js` as the first `on` handler of
   every operation. The mock extends it; the real adapter (phase 10) must too - InvoiceService
   refuses to start if `ExternalPurchaseOrderService` is not a `FacadeService`. Callers in
   InvoiceService go through one helper (`s4(operation, data, invoiceID)`).

2. **Timeout 5,000 ms** (`cds.requires.ExternalPurchaseOrderService.timeout`) on every
   operation. The operation gets an `AbortSignal` (`req.abortSignal`) and is aborted when the time
   is up; the timer is always cleared. A business "not found" (404) passes through unchanged;
   every other failure - timeout, error, unreachable - becomes **503 S4_UNAVAILABLE** with a
   user text that reveals nothing technical. Parallel S/4 calls in one request are awaited until
   all have finished (`allSettled`) before the request fails, so no call is still running when
   the request ends.

3. **MessageLog survives the rollback: deferred, separate transaction.** The guard records one
   row per call (correlation ID, operation, invoice, SUCCESS/FAILED, duration, sanitized error -
   no payloads, credentials, user names or business data). Rows are collected per request and
   written in a **new root transaction** when the request's transaction has ended (CAP context
   `done`, after commit *or* rollback); outside a request, or after its end, immediately.
   - Why not an independent transaction right away: SQLite (in-memory: one connection; files:
     one writer) would wait for the request's open write transaction forever. Writing after the
     end works on every database.
   - Limitation: a process crash between an S/4 call and the end of the request loses those
     rows. A HANA deployment could write immediately in its own transaction; not needed now.
   - Error texts are sanitized (`sanitize`): first line only, URLs/tokens/passwords removed,
     at most 300 characters.

4. **Correlation ID = `cds.context.id`.** One per incoming request (CAP takes `x-correlation-id`
   from the caller, or creates one), shared by all facade calls of that request through CAP's
   async context - no global variable. Verified with parallel requests.

5. **R2: no duplicate match runs.** The match handler (a) reads the invoice `forUpdate()` - a
   row lock on HANA/PostgreSQL, nothing on SQLite - and (b) changes the status *before* writing
   results, through the status machine's compare-and-set
   (`UPDATE ... where status = 'VALIDATED'`, 409 `INVALID_STATUS_TRANSITION` if 0 rows). A
   request that loses the race writes nothing. On SQLite, writers are serialized as well, so
   the loser re-reads MATCHED/EXCEPTION and gets the same 409. No in-memory mutex.
   Tested: parallel requests (5 rounds per run) and a simulated interleaving where the status
   changes between read and write.

6. **MOCK failure modes are config, mock-only.** `cds.requires.ExternalPurchaseOrderService.mock.failureMode`
   = `none` (default) | `timeout` | `error`, set only in the `[development]`/`[test]` profiles and
   read only by `mock-po-service.js` (a unit test checks no other file reads it). The production
   configuration has no mock implementation and no failure mode.

7. **Integration Log app** shows the real rows, newest first: status with criticality,
   operation, invoice number (via a read-only `InvoiceRefs` projection exposing only ID and
   number), duration, error, correlation ID; filters for status, operation, target system,
   timestamp and correlation ID; search over correlation ID, operation and error text.
   AP Manager only, read-only (405 on writes), not in InvoiceService or ExceptionService.

## Consequences

- Two Phase 7 tests asserted "empty until phase 8" (log and empty-state text). They now assert
  the phase 8 behaviour (log holds exactly the real calls, no seed rows; new empty-state text).
- A failed first submission logs the draft's ID; there is no saved invoice to show a number for.
