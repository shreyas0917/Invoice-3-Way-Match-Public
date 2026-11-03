/**
 * InvoiceService handlers.
 *
 * Phase 2: draft defaults and facade-backed value helps.
 * Phase 3: submission (draft activation) with validation V1-V10, exact-duplicate
 * block D1, invoice numbering and snapshots, and the checkDuplicates function.
 * Phase 4: the match action (3-way match through MatchingEngine, persisted as one run).
 * Phase 5: release, approve, reject, block, unblock, cancel; edit/delete guards; history.
 * Every status change goes through srv/lib/status-machine.js.
 */
const cds = require('@sap/cds')
const { applyQuery, equalityValue, searchText } = require('./lib/value-help')
const { checkAmounts, checkAgainstPurchaseOrder } = require('./lib/invoice-validation')
const { normalizeReference, fiscalYearOf, NON_BLOCKING_STATUSES } = require('./lib/duplicate')
const { toScaled, Ratio } = require('./lib/decimal')
const statusMachine = require('./lib/status-machine')
const { writeHistory } = require('./lib/history')
const FacadeService = require('./external/facade-service')

/**
 * Status actions of InvoiceService: event -> status-machine action and the text it needs.
 * `text` names the action parameter holding the reason/comment; `required` makes it mandatory.
 */
const STATUS_ACTIONS = Object.freeze({
  release: { action: 'RELEASE' },
  approve: { action: 'APPROVE', text: 'comment' },
  reject:  { action: 'REJECT', text: 'reason', required: 'REASON_REQUIRED', blockReason: true },
  block:   { action: 'BLOCK', text: 'reason', required: 'REASON_REQUIRED', blockReason: true },
  unblock: { action: 'UNBLOCK', text: 'comment', required: 'COMMENT_REQUIRED' },
  cancel:  { action: 'CANCEL', text: 'reason', required: 'REASON_REQUIRED' }
})

module.exports = class InvoiceService extends cds.ApplicationService {
  async init() {
    const {
      Invoices, InvoiceItems, ApprovalQueue, MatchResults: MatchResultsView,
      Suppliers, PurchaseOrders, PurchaseOrderItems
    } = this.entities
    // Submitted (active) invoices and the other app tables in the database.
    const {
      Invoices: SubmittedInvoices, InvoiceItems: SubmittedItems,
      MatchResults, Exceptions, ToleranceRules, ApprovalPolicies
    } = cds.entities('ap')
    const SavedResults = MatchResults

    // The only door to S/4 data. Mock or real adapter is chosen by configuration.
    const facade = await cds.connect.to('ExternalPurchaseOrderService')
    // No unguarded S/4 access: the implementation must extend FacadeService (timeout + MessageLog).
    if (!(facade instanceof FacadeService))
      throw new Error('ExternalPurchaseOrderService must be implemented by a subclass of srv/external/facade-service.js')
    const engine = await cds.connect.to('MatchingEngine')
    // Every S/4 call goes through here. The facade guard adds timeout and MessageLog; the
    // header only tells the log which invoice the call was for (no payload is logged).
    const s4 = (event, data, invoiceID) =>
      facade.send({ event, data, headers: invoiceID ? { 'x-invoice-id': invoiceID } : {} })

    // --- 3-way match --------------------------------------------------------------
    // 1. guard: only a saved invoice in status VALIDATED can be matched
    // 2. read the current supplier, PO and goods receipts through the facade and re-check
    //    them (S/4 may have changed since submission); no writes happen before this point
    // 3. gather local data: quantities on other invoices, rules, policy, possible duplicates
    // 4. MatchingEngine decides; 5. persist one run. All in the request's transaction:
    //    any error rolls back results, exceptions and status together. A failing or slow
    //    S/4 call (503 S4_UNAVAILABLE) happens in step 2, so it leaves the invoice VALIDATED.

    // Called on a draft, the action is dispatched to Invoices.drafts.
    this.on('match', Invoices.drafts, req =>
      req.reject({ status: 409, code: 'MATCH_REQUIRES_SAVED_INVOICE', message: 'MATCH_REQUIRES_SAVED_INVOICE' }))

    this.on('match', Invoices, async req => {
      const { ID } = req.params[0]
      const invoice = await SELECT.one.from(SubmittedInvoices).where({ ID }).forUpdate()
      if (!invoice) return req.reject(404)
      statusMachine.assertAllowed('MATCH', invoice.status) // 409 before any S/4 call
      invoice.items = await SELECT.from(SubmittedItems).where({ up__ID: ID })

      const [supplier, po, receivedQuantities] = await allSettled([
        orNull(s4('getSupplier', { supplierID: invoice.supplierID }, ID)),
        orNull(s4('getPurchaseOrder', { purchaseOrder: invoice.purchaseOrder }, ID)),
        orNull(s4('getReceivedQuantities', { purchaseOrder: invoice.purchaseOrder }, ID))
      ])
      const issues = checkAgainstPurchaseOrder(invoice, supplier, po)
      if (issues.length) {
        for (const issue of issues)
          req.error({ status: 409, code: issue.code, message: issue.code, args: issue.args, target: targetOf(issue, true) })
        return // CAP throws the collected errors; nothing has been written
      }

      const [invoicedQuantities, toleranceRules, approvalPolicy, possibleDuplicates] = await Promise.all([
        SELECT.from(SubmittedItems).columns('purchaseOrderItem', 'quantity')
          .where`up_.purchaseOrder = ${invoice.purchaseOrder} and up_.ID != ${ID}`
          .and(notCancelled(['up_', 'status'])),
        SELECT.from(ToleranceRules).columns('ID', 'companyCode', 'varianceType', 'upperPercent', 'lowerPercent',
          'upperAbsolute', 'lowerAbsolute', 'currency_code', 'validFrom', 'validTo', 'isActive'),
        SELECT.one.from(ApprovalPolicies).columns('companyCode', 'autoReleaseLimit', 'currency_code')
          .where({ companyCode: invoice.companyCode }),
        SELECT.from(SubmittedInvoices).columns('ID', 'invoiceNumber', 'normalizedReference', 'grossAmount')
          .where({ supplierID: invoice.supplierID, invoiceDate: invoice.invoiceDate, ID: { '!=': ID } })
          .and(notCancelled())
      ])

      const evaluation = await engine.send('evaluate', {
        invoice: {
          ID, companyCode: invoice.companyCode, currency_code: invoice.currency_code,
          invoiceDate: invoice.invoiceDate, grossAmount: invoice.grossAmount,
          normalizedReference: invoice.normalizedReference,
          items: invoice.items.map(({ ID, itemNo, purchaseOrderItem, quantity, unitPrice }) =>
            ({ ID, itemNo, purchaseOrderItem, quantity, unitPrice }))
        },
        purchaseOrder: po,
        receivedQuantities: receivedQuantities ?? [],
        invoicedQuantities, toleranceRules, approvalPolicy: approvalPolicy ?? null, possibleDuplicates
      })

      // Persist one run: results (insert-only), exceptions, item and invoice status.
      const runID = cds.utils.uuid(), runAt = new Date().toISOString()
      const resultIdOfItem = {}
      const results = evaluation.items.map(({ invoiceItemID, appliedPriceRuleID, appliedQtyRuleID, matchStatus, ...snapshot }) => {
        const resultID = resultIdOfItem[invoiceItemID] = cds.utils.uuid()
        return {
          ID: resultID, invoice_ID: ID, invoiceItem_ID: invoiceItemID, runID, runAt, ...snapshot,
          appliedPriceRule_ID: appliedPriceRuleID, appliedQtyRule_ID: appliedQtyRuleID
        }
      })
      const exceptions = evaluation.exceptions.map(e => ({
        invoice_ID: ID,
        invoiceItem_ID: e.invoiceItemID ?? null,
        matchResult_ID: e.invoiceItemID ? resultIdOfItem[e.invoiceItemID] : null,
        relatedInvoice_ID: e.relatedInvoiceID ?? null,
        runID, type: e.type, responsibleRole: e.responsibleRole, purchasingGroup: e.purchasingGroup,
        varianceAmount: e.varianceAmount, status: 'OPEN'
      }))

      // R2: the status change comes first. It is a compare-and-set (UPDATE ... where
      // status = 'VALIDATED'), so if a parallel request matched the invoice in the meantime it
      // fails with 409 before this run writes anything. forUpdate() above locks the row on
      // HANA/PostgreSQL; SQLite has no row locks but serializes writers, and the CAS covers both.
      await statusMachine.transition({
        invoice, action: 'MATCH', to: evaluation.outcome.status, user: req.user,
        set: { approvalReason: evaluation.outcome.approvalReason, lastMatchRunID: runID, lastMatchAt: runAt },
        comment: exceptions.length ? `${exceptions.length} exception(s): ${[...new Set(exceptions.map(e => e.type))].join(', ')}`
          : evaluation.outcome.approvalReason ?? null
      })
      await INSERT.into(MatchResults).entries(results)
      if (exceptions.length) await INSERT.into(Exceptions).entries(exceptions)
      for (const { invoiceItemID, matchStatus } of evaluation.items)
        await UPDATE(SubmittedItems, invoiceItemID).with({ matchStatus })

      for (const { code, args } of evaluation.warnings) req.warn({ code, message: code, args })
      return this.run(SELECT.one.from(Invoices).where({ ID, IsActiveEntity: true }))
    })

    // --- Submission: Save on a draft activates it ------------------------------
    // req.data is the complete draft including items. Any error rolls the whole
    // activation back: the draft stays as it was and gets the messages attached.

    this.before('SAVE', Invoices, async req => {
      const invoice = req.data
      // New invoice (no status yet) or a VALIDATED invoice edited again; 409 otherwise.
      const fromStatus = invoice.status ?? null
      const toStatus = statusMachine.targetStatus('SUBMIT', fromStatus)

      // V1-V3 (amounts, items) and V4-V10 (against S/4 data via the facade)
      const [supplier, po] = await allSettled([
        invoice.supplierID && orNull(s4('getSupplier', { supplierID: invoice.supplierID }, invoice.ID)),
        invoice.purchaseOrder && orNull(s4('getPurchaseOrder', { purchaseOrder: invoice.purchaseOrder }, invoice.ID))
      ])
      const issues = [...checkAmounts(invoice), ...checkAgainstPurchaseOrder(invoice, supplier, po)]
      for (const issue of issues) {
        req.error({ status: 400, code: issue.code, message: issue.code, args: issue.args, target: targetOf(issue) })
      }
      if (issues.length) return // CAP throws the collected errors after the before phase

      // Derived fields, needed for D1
      invoice.normalizedReference = normalizeReference(invoice.supplierReference)
      invoice.fiscalYear = fiscalYearOf(invoice.invoiceDate)

      // D1 exact duplicate: stop immediately with 409
      const duplicate = await SELECT.one.from(SubmittedInvoices)
        .columns('ID', 'invoiceNumber')
        .where({ supplierID: invoice.supplierID, normalizedReference: invoice.normalizedReference, fiscalYear: invoice.fiscalYear })
        .and({ ID: { '!=': invoice.ID } })
        .and(notCancelled())
      if (duplicate) {
        return req.reject({
          status: 409, code: 'DUPLICATE_INVOICE', message: 'DUPLICATE_INVOICE',
          args: [invoice.supplierReference, invoice.supplierID, invoice.fiscalYear, duplicate.invoiceNumber ?? duplicate.ID],
          target: 'in/supplierReference'
        })
      }

      // Snapshots and status
      invoice.supplierName = supplier.name
      invoice.purchasingGroup = po.purchasingGroup
      invoice.invoiceNumber ??= await nextInvoiceNumber(invoice.fiscalYear)
      // Status from the status machine; CAP's draft activation writes it with the invoice.
      invoice.status = toStatus
      await writeHistory({ invoiceID: invoice.ID, action: 'SUBMIT', fromStatus, toStatus, user: req.user })
    })

    // --- Edit and delete guards ---------------------------------------------------

    // A submitted invoice can be edited (new draft) only while VALIDATED; later the
    // matching results would no longer describe it.
    this.before('EDIT', Invoices, async req => {
      const { ID } = req.params[0] ?? req.data
      const invoice = await SELECT.one.from(SubmittedInvoices).columns('status').where({ ID })
      if (invoice) statusMachine.assertEditable(invoice.status)
    })

    // Submitted invoices are never deleted (block and cancel instead); drafts can be discarded.
    this.before('DELETE', Invoices, req =>
      req.reject({ status: 409, code: 'ACTIVE_INVOICE_NOT_DELETABLE', message: 'ACTIVE_INVOICE_NOT_DELETABLE' }))

    // --- Status actions: release, approve, reject, block, unblock, cancel ----------
    // Each: read the invoice (row lock) -> check status -> check reason/SoD -> transition
    // (status + history). One transaction; any error rolls everything back.
    // Who may call which action is declared with @restrict in invoice-service.cds.
    // The Approval Queue offers approve, reject and block on the same handler.

    for (const [event, config] of Object.entries(STATUS_ACTIONS)) {
      this.on(event, Invoices.drafts, req =>
        req.reject({ status: 409, code: 'SAVED_INVOICE_REQUIRED', message: 'SAVED_INVOICE_REQUIRED', args: [event] }))

      const targets = ['approve', 'reject', 'block'].includes(event) ? [Invoices, ApprovalQueue] : [Invoices]
      this.on(event, targets, async req => {
        const { ID } = req.params[0]
        const invoice = await SELECT.one.from(SubmittedInvoices).where({ ID }).forUpdate()
        if (!invoice) return req.reject(404)
        statusMachine.assertAllowed(config.action, invoice.status)

        const text = config.text ? req.data[config.text]?.trim() || null : null
        if (config.required && !text)
          return req.reject({ status: 400, code: config.required, message: config.required, target: config.text })

        // Segregation of duties: nobody approves an invoice they created.
        if (config.action === 'APPROVE' && invoice.createdBy === req.user.id)
          return req.reject({ status: 403, code: 'SOD_SELF_APPROVAL', message: 'SOD_SELF_APPROVAL' })

        await statusMachine.transition({
          invoice, action: config.action, user: req.user, comment: text,
          set: config.blockReason ? { blockReason: text } : {}
        })
        // Unblocked or cancelled before every exception was decided: those exceptions no
        // longer describe the invoice (a new match decides afresh, or it is closed).
        if (config.action === 'UNBLOCK' || config.action === 'CANCEL')
          await UPDATE(Exceptions).set({ status: 'SUPERSEDED', resolvedBy: req.user.id, resolvedAt: new Date().toISOString() })
            .where({ invoice_ID: ID, status: 'OPEN' })

        // From the Approval Queue the invoice has left the queue: nothing to return (204),
        // Fiori removes the row when it refreshes the list.
        if (req.target === ApprovalQueue) return null
        return this.run(SELECT.one.from(Invoices).where({ ID, IsActiveEntity: true }))
      })
    }

    // --- Computed display fields (phase 7) ------------------------------------------

    // Money at stake: sum of the variance amounts of the invoice's open exceptions.
    this.after('READ', [Invoices, Invoices.drafts, ApprovalQueue], async rows => {
      const list = (Array.isArray(rows) ? rows : [rows]).filter(row => row?.ID)
      if (!list.length) return
      const open = await SELECT.from(Exceptions).columns('invoice_ID', 'varianceAmount')
        .where({ invoice_ID: { in: list.map(row => row.ID) }, status: 'OPEN' })
      for (const row of list)
        row.moneyAtStake = open.filter(e => e.invoice_ID === row.ID)
          .reduce((sum, e) => sum.plus(e.varianceAmount ?? 0), Ratio.of(0)).toFixed(2)
    })

    // Item currency = the invoice's currency (display only), for active items and drafts.
    this.after('READ', [InvoiceItems, InvoiceItems.drafts], async (rows, req) => {
      const list = (Array.isArray(rows) ? rows : [rows]).filter(row => row?.ID)
      if (!list.length) return
      const isDraft = req.target === InvoiceItems.drafts
      const items = await SELECT.from(isDraft ? InvoiceItems.drafts : SubmittedItems).columns('ID', 'up__ID')
        .where({ ID: { in: list.map(row => row.ID) } })
      const parentIDs = [...new Set(items.map(i => i.up__ID))]
      const parents = parentIDs.length
        ? await SELECT.from(isDraft ? Invoices.drafts : SubmittedInvoices).columns('ID', 'currency_code').where({ ID: { in: parentIDs } })
        : []
      for (const row of list) {
        const parentID = items.find(i => i.ID === row.ID)?.up__ID
        row.currency_code = parents.find(p => p.ID === parentID)?.currency_code ?? null
      }
    })

    // Applied tolerance rules as readable text, e.g. "Global: +2.00 % / -5.00 %, 500.00 / 500.00 INR".
    this.after('READ', MatchResultsView, rows => fillRuleTexts(rows))

    // Rows reached by $expand do not pass through their own READ handler: fill them here.
    this.after('READ', [Invoices, Invoices.drafts, ApprovalQueue], async rows => {
      const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean)
      await fillRuleTexts(list.flatMap(row => [...(row.latestMatchResults ?? []), ...(row.matchResults ?? [])]))
      for (const row of list) for (const item of row.items ?? []) if (row.currency_code !== undefined) item.currency_code = row.currency_code
    })

    async function fillRuleTexts(rows) {
      const list = (Array.isArray(rows) ? rows : [rows]).filter(row => row?.ID)
      if (!list.length) return
      const links = await SELECT.from(SavedResults).columns('ID', 'appliedPriceRule_ID', 'appliedQtyRule_ID')
        .where({ ID: { in: list.map(row => row.ID) } })
      const ruleIDs = [...new Set(links.flatMap(l => [l.appliedPriceRule_ID, l.appliedQtyRule_ID]).filter(Boolean))]
      const rules = ruleIDs.length ? await SELECT.from(ToleranceRules).where({ ID: { in: ruleIDs } }) : []
      const text = id => {
        const rule = rules.find(r => r.ID === id)
        if (!rule) return 'No rule: zero tolerance'
        return `${rule.companyCode || 'Global'}: +${rule.upperPercent} % / -${rule.lowerPercent} %, ` +
          `${rule.upperAbsolute} / ${rule.lowerAbsolute} ${rule.currency_code}`
      }
      for (const row of list) {
        const link = links.find(l => l.ID === row.ID)
        row.priceRuleText = text(link?.appliedPriceRule_ID)
        row.qtyRuleText = text(link?.appliedQtyRule_ID)
      }
    }

    /** INV-<fiscal year>-<6-digit sequence>; @assert.unique guards against races. */
    async function nextInvoiceNumber(fiscalYear) {
      const prefix = `INV-${fiscalYear}-`
      const { last } = await SELECT.one.from(SubmittedInvoices)
        .columns('max(invoiceNumber) as last')
        .where({ invoiceNumber: { like: `${prefix}%` } })
      const next = last ? Number(last.slice(prefix.length)) + 1 : 1
      return prefix + String(next).padStart(6, '0')
    }

    // --- Live duplicate check for the draft UI ----------------------------------

    this.on('checkDuplicates', async req => {
      const { supplierID, supplierReference, invoiceDate, grossAmount } = req.data
      if (!supplierID) return []
      const normalizedReference = supplierReference ? normalizeReference(supplierReference) : null
      const fiscalYear = fiscalYearOf(invoiceDate)
      if (!fiscalYear) return [] // both rules need the invoice date

      const query = SELECT.from(SubmittedInvoices)
        .columns('ID', 'invoiceNumber', 'supplierReference', 'normalizedReference', 'invoiceDate', 'fiscalYear',
          'grossAmount', 'currency_code', 'status')
        .where({ supplierID })
        .and(notCancelled())
        .orderBy('invoiceDate desc')
      if (normalizedReference)
        query.and`(normalizedReference = ${normalizedReference} and fiscalYear = ${fiscalYear} or invoiceDate = ${invoiceDate})`
      else
        query.and({ invoiceDate })
      const candidates = await query

      const gross = grossAmount == null ? null : toScaled(grossAmount, 2)
      return candidates.flatMap(c => {
        let reason
        if (normalizedReference && c.normalizedReference === normalizedReference && c.fiscalYear === fiscalYear)
          reason = 'SAME_REFERENCE'
        else if (gross !== null && c.invoiceDate === invoiceDate && toScaled(c.grossAmount, 2) === gross)
          reason = 'SAME_DATE_AND_AMOUNT'
        if (!reason) return []
        const { normalizedReference: _n, fiscalYear: _f, ...visible } = c
        return [{ ...visible, reason }]
      })
    })

    // --- Draft defaults --------------------------------------------------------

    this.before('NEW', Invoices.drafts, req => {
      const defaults = cds.env.invoiceWorkbench?.defaults ?? {}
      req.data.companyCode ??= defaults.companyCode
      if (defaults.currency) req.data.currency_code ??= defaults.currency
    })

    this.before('NEW', InvoiceItems.drafts, async req => {
      if (req.data.itemNo != null || !req.data.up__ID) return
      const { max } = await SELECT.one.from(InvoiceItems.drafts)
        .columns('max(itemNo) as max')
        .where({ up__ID: req.data.up__ID })
      req.data.itemNo = (max ?? 0) + 1
    })

    // --- Value helps, answered through the facade -----------------------------

    this.on('READ', Suppliers, async req => {
      const select = req.query.SELECT
      const supplierID = equalityValue(select, 'supplierID')
      // A value help shows "no entries" for unknown keys instead of failing with 404.
      const rows = supplierID
        ? [await orNull(s4('getSupplier', { supplierID }))].filter(Boolean)
        : await s4('searchSuppliers', { text: searchText(select) })
      return applyQuery(rows, select)
    })

    this.on('READ', PurchaseOrders, async req => {
      const select = req.query.SELECT
      const rows = await s4('searchPurchaseOrders', {
        text: equalityValue(select, 'purchaseOrder') ?? '',
        supplierID: equalityValue(select, 'supplierID') ?? null
      })
      return applyQuery(rows.map(toPurchaseOrderRow), select)
    })

    this.on('READ', PurchaseOrderItems, async req => {
      const select = req.query.SELECT
      const purchaseOrder = equalityValue(select, 'purchaseOrder')
      // Items only make sense for one PO: without a chosen PO the list is empty.
      const rows = purchaseOrder
        ? (await orNull(s4('listPurchaseOrderItems', { purchaseOrder }))) ?? []
        : []
      return applyQuery(rows.map(toPurchaseOrderItemRow), select)
    })

    return super.init()
  }
}

/**
 * Like Promise.all, but for parallel S/4 calls: waits until every call has finished before
 * failing, so no call is still running - and not yet logged - when the request ends.
 */
async function allSettled(promises) {
  const results = await Promise.allSettled(promises)
  const failed = results.find(r => r.status === 'rejected')
  if (failed) throw failed.reason
  return results.map(r => r.value)
}

/** Resolves to null when the facade reports 404 (unknown key); other errors propagate. */
async function orNull(promise) {
  try {
    return await promise
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

/**
 * Message target for a validation issue, so Fiori highlights the field. Relative to the
 * action's binding parameter 'in' (the invoice draft), like CAP's own @mandatory/@assert
 * messages: 'in/grossAmount' or 'in/items(ID=…,IsActiveEntity=false)/quantity'.
 * On a saved invoice (the match action) item targets point to the active item.
 */
function targetOf({ field, itemID }, isActiveEntity = false) {
  return itemID ? `in/items(ID=${itemID},IsActiveEntity=${isActiveEntity})/${field}` : `in/${field}`
}

/**
 * Invoices that still count for duplicates and open quantities: every status except
 * CANCELLED (D4). Invoices without a status (saved before phase 3) count as well.
 * @param statusRef path to the invoice status, e.g. ['up_', 'status'] from an item
 */
function notCancelled(statusRef = ['status']) {
  return {
    xpr: [{ ref: statusRef }, 'is', 'null', 'or', { ref: statusRef }, 'not', 'in',
      { list: NON_BLOCKING_STATUSES.map(val => ({ val })) }]
  }
}

/** Facade PurchaseOrder -> PurchaseOrders value-help row. */
function toPurchaseOrderRow(po) {
  return {
    purchaseOrder: po.purchaseOrder,
    supplierID: po.supplierID,
    companyCode: po.companyCode,
    purchasingGroup: po.purchasingGroup,
    currency_code: po.currency,
    orderDate: po.orderDate,
    isDeleted: po.isDeleted
  }
}

/** Facade PurchaseOrderItem -> PurchaseOrderItems value-help row (adds the unit price). */
function toPurchaseOrderItemRow(item) {
  return {
    purchaseOrder: item.purchaseOrder,
    item: item.item,
    material: item.material,
    description: item.description,
    orderQuantity: item.orderQuantity,
    orderUnit: item.orderUnit,
    netPrice: item.netPrice,
    priceUnit: item.priceUnit,
    unitPrice: Math.round((item.netPrice / item.priceUnit) * 100) / 100,
    grBasedIV: item.grBasedIV,
    isDeleted: item.isDeleted
  }
}
