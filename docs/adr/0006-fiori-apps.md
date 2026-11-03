# ADR 0006 - Fiori elements apps

- Status: accepted
- Date: 2026-11-03
- Phase: 7

## Decisions

1. **Five Fiori elements apps, no custom UI code.** Invoice Workbench, Exception Worklist,
   Approval Queue, Tolerance Configuration, Integration Log: List Report + Object Page from
   manifest + CDS annotations, SAPUI5 1.148 (long-term maintenance). Grid tables for lists and
   data-heavy sections, so no column is hidden on smaller screens.

2. **Approval Queue is a server-side projection** (`InvoiceService.ApprovalQueue`, `where status
   = 'PENDING_APPROVAL'`, AP Manager only, read-only, `@cds.redirection.target: false`), not a UI
   filter on Invoices: a client cannot remove it, and its own annotations (columns, Approve/Reject
   buttons) do not clash with the Workbench's. approve/reject/block run the same handler, status
   machine and SoD check. The action returns nothing once the invoice has left the queue; a side
   effect reloads the queue.

3. **Resolve dialog value help from the status machine.** `ExceptionService.AllowedResolutions`
   (no table) serves `RESOLUTIONS_BY_TYPE`, the table `resolve` itself checks; the dropdown
   filters by the exception's type (`in/type`). Verified in the browser: NO_GR offers only
   Rematch and Reject.

4. **Computed display fields are virtual** and filled on read, also for `$expand`ed rows:
   `moneyAtStake` (open exception amounts), `priceRuleText` / `qtyRuleText` (applied rules),
   `howRulesApply` (tolerance explanation), `InvoiceItems.currency_code`. The item currency
   replaced `@Measures.ISOCurrency: up_.currency_code`, which made Fiori offer an editable
   currency on every item row that could not be saved - found in the browser click-through.

5. **MessageLog model added early** (phase 8 writes it). The Integration Log binds to the real,
   empty, read-only entity and says so; no rows are invented.

6. **Required reasons are checked by the backend**, which returns the message on the dialog
   field (verified: "Enter a reason." on Block). Mandatory markers on action parameters would
   make CAP answer with a generic code first (ADR 0004).

7. **Local launch page** `app/index.html` replaces CAP's generated index; saved variants use the
   browser's local storage (UI5 LocalStorageConnector). Neither is used on BTP.

## Found and fixed during the browser verification

- The app pages lacked `html, body, #container-uiarea { height: 100% }`: every app (including
  the phase 2 Workbench) rendered as an empty page in a real browser.
- Item currency field (see 4) prevented saving an invoice entered in the UI.
- Approval Queue did not refresh after approving (see 2).
