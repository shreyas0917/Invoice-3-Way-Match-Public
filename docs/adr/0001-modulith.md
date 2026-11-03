# ADR 0001 - One deployable CAP application (modulith)

- Status: accepted
- Date: 2026-11-02

## Context

The Invoice 3-Way Match Workbench has several concerns: invoice entry, matching,
exception handling, administration and access to S/4HANA data. These could be split
into separate microservices, each with its own database and deployment.

## Decision

Build **one** CAP Node.js application: one process, one database, one deployment
(a "modulith"). Concerns are separated by **CAP services** inside that process
(InvoiceService, ExceptionService, AdminService, MatchingEngine,
ExternalPurchaseOrderService), not by network boundaries. This follows CAP's own
guidance to modularise with services and avoid premature microservices.

## Consequences

- One transaction can cover a whole match run (results, exceptions, status, history).
- Local development needs nothing but `cds watch` and SQLite.
- Internal services (`@protocol: 'none'`) are callable in-process but never over HTTP.
- If a module ever needs to scale independently, the service boundary is already there;
  it can be moved out later without rewriting its callers.
