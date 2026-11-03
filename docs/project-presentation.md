# Three-minute project presentation

Spoken text for a fresher interview, about 3 minutes in total. Short sentences, natural pace. The
times are a guide; practise with a timer. Show the screenshots in the README (or the running app)
while you speak.

---

## 1. Introduction (30 seconds)

"My project is the **Invoice 3-Way Match Workbench**. It is an SAP CAP application with SAP Fiori
elements, written in Node.js.

It helps an accounts payable team check supplier invoices before they are paid. I built it phase
by phase from a technical blueprint, with tests in every phase - today there are 388 automated
tests.

It runs completely on my laptop with simulated SAP data. I also prepared the SAP BTP deployment,
but I have not deployed it yet, because I don't have a BTP account."

## 2. The business problem (45 seconds)

"Before a company pays an invoice, it should compare three documents.

The **purchase order** says what we ordered and at what price. The **goods receipt** says what
actually arrived. And the **invoice** says what the supplier wants to be paid.

If the price is a little higher, or only part of the goods arrived, or the same invoice comes twice,
the company can pay too much. Doing this by hand is slow, and it is often unclear who should decide a
difference.

My application does the comparison automatically. When something does not match, it creates an
exception and sends it to the right person: the **buyer** of that purchasing group, or the **AP
manager**. Every decision is recorded in an audit history."

## 3. Architecture (60 seconds)

"The application is one CAP Node.js application - a modular monolith. I chose this on purpose: one
match run updates several tables, and with one database transaction they always stay consistent.

Inside, there are five CAP services. Three are OData V4 services for the five Fiori apps: one for
invoices, one for exceptions, one for administration. Two are internal: the **matching engine**, and
a **facade** for SAP S/4HANA data.

The facade is important. The business logic never talks to SAP directly. It asks the facade for a
supplier, a purchase order or received quantities. Behind the facade I have two implementations: a
mock with test data, and an **adapter for the official SAP APIs** - Purchase Order in OData V4,
Material Document and Business Partner in OData V2. I switch between them only by configuration.

Every SAP call has a five-second timeout, a clear error message for the user, and one row in an
Integration Log.

Security is declared in CDS: three roles, and buyers only see their own purchasing group. Locally I
use SQLite and mocked users. For BTP I configured HANA Cloud, XSUAA and an App Router in an MTA."

## 4. The matching engine (45 seconds)

"The matching engine is a pure function. It gets all the data as input and returns the result - it
does not read or write the database, so it is easy to test.

For every invoice line it checks three things, in order. First the **price**: is the invoice price
within the tolerance of the PO price? For example, plus two percent and at most 500 rupees. Second,
the **goods receipt**: did anything arrive? Receipts are movement type 101, reversals are 102, so
I use the net amount. Third, the **quantity**: is the invoiced quantity more than what is still open?

All money calculations use exact decimal arithmetic with BigInt, because normal JavaScript numbers
can give rounding errors - and here, a rounding error decides whether money is paid."

## 5. Challenges and outcomes (30 seconds)

"Some challenges I solved: a security test showed that a buyer could see a manager-only exception
through an OData `$expand`, so I closed that path. I made parallel 'Match' clicks safe - only one
succeeds. And SAP errors are logged, even when the business transaction rolls back.

The result: a working, well-tested application with 388 tests, five Fiori apps, and nine documented
architecture decisions. The next step is to deploy it to SAP BTP and connect it to a real S/4HANA
system - that part I have prepared, but not yet verified."

---

## Tips

- Do not claim a live SAP connection or a BTP deployment. If asked: "prepared and built, not deployed."
- If you have more time, open the app and show one invoice moving from Exception to Released.
- Be ready to show code: `srv/lib/matching.js` (engine), `srv/lib/status-machine.js` (statuses),
  `srv/exception-service.cds` (purchasing-group restriction), `srv/external/s4-adapter.js` (SAP mapping).
