# ADR 0005 - Authorization model

- Status: accepted
- Date: 2026-11-03
- Phase: 6

## Decisions

1. **Declared in CDS, enforced by CAP.** Every exposed service has `@requires`; entities and
   bound actions have `@restrict`. The same annotations work with mocked users locally and
   with XSUAA / Identity Services tokens on BTP. JavaScript adds only what CDS cannot
   express: segregation of duties (`approve`: creator != approver), which compares two
   values of the same record.

2. **Matrix** (blueprint "Role matrix"):

   | Service / entity | AP Clerk | Buyer | AP Manager |
   |---|---|---|---|
   | InvoiceService (service) | yes | **no** | yes |
   | Invoices READ | all | - | all |
   | Invoices WRITE (new draft, edit, Save) | yes | - | no |
   | match, release, block | yes | - | yes |
   | approve, reject, unblock, cancel | no | - | yes (approve: not own invoices) |
   | MatchResults, Exceptions, ApprovalHistory, rules (read-only) | all | - | all |
   | ExceptionService (service) | **no** | yes | yes |
   | Exceptions READ / resolve | - | own group, BUYER-type | all |
   | Invoices, InvoiceItems, MatchResults, ApprovalHistory (read-only) | - | own group | all |
   | AdminService: ToleranceRules (draft), ApprovalPolicies | no | no | yes |

3. **Buyer isolation** uses instance-based restrictions:
   `purchasingGroup = $user.purchasingGroup and responsibleRole = 'BUYER'` on Exceptions (read
   and resolve) and the purchasing group of the invoice on the related entities. CAP applies
   the restriction to every request on those entity sets, including `$filter`, `$batch` and
   reads by key (404 for other groups). A user without the attribute matches nothing.

4. **No associations that escape the restriction.** CAP does not filter rows reached by
   `$expand` or navigation from another entity by the *target's* instance restriction.
   Verified: a buyer could read the AP-Manager-only DUPLICATE_SUSPECT of an own-group
   invoice through `Invoices(...)?$expand=exceptions`. ExceptionService therefore does not
   expose `Invoices.exceptions/matchResults/latestMatchResults/history` and
   `ApprovalHistory.exception`; buyers use the restricted entity sets directly.

5. **No change history in ExceptionService.** The change-tracking plugin would add a
   `ChangeView` with the field changes of all invoices and exceptions; it cannot be filtered by
   purchasing group, so it is switched off there (`@changelog.disable_assoc`). Change history
   stays available to AP Clerks and AP Managers in InvoiceService.

6. **AP Managers cannot create invoices** (blueprint matrix). The blueprint's test user
   description ("manager1 also creates one invoice to test SoD") contradicts that, so the SoD
   test uses a fixture invoice created by manager1 (`test/data`, fiscal year 2025).

7. **Mocked users** (development and test profiles only, `package.json`): clerk1, clerk2
   (APClerk), buyer1 (Buyer, purchasingGroup 001), buyer2 (Buyer, 002), manager1 (APManager),
   nobody (no role). CAP's sample users (alice, bob, carol, dave, erin, fred, me, yves) are set
   to `false` one by one - `"*": false` alone only refuses unknown user names. The production
   profile uses `jwt` (XSUAA); mocked users never reach it.

## Gaps

- **MessageLog** does not exist yet (phase 8). AdminService is AP Manager only at service level,
  so it will be protected when added; it must be `@readonly`.
- **Default restrictions on the remaining InvoiceService entities** rely on `@readonly` plus the
  service-level `@requires`: both AP roles may read everything there, as the matrix says.
- **CAP start-up warnings** for the action names `reject` and `resolve` (see ADR 0004).
