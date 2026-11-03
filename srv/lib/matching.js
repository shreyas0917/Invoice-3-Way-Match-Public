/**
 * Three-way matching (blueprint workflows 4-8) as one pure function.
 *
 * Takes everything it needs as plain data (invoice, PO and goods receipts as read
 * through the facade, quantities on other invoices, tolerance rules, approval policy,
 * possible duplicates) and returns verdicts. It reads nothing and writes nothing, so it
 * is unit-testable and safe to call twice. InvoiceService persists the result.
 *
 * Per item, in this order (the first failure becomes MatchResults.result):
 *  1. price    : invoice unit price vs PO unit price (netPrice ÷ priceUnit)
 *  2. GR       : GR-based items need a net goods receipt (101 − 102) above zero (NO_GR)
 *  3. quantity : invoiced vs open quantity; skipped after NO_GR, because without a
 *                receipt there is nothing to compare against and NO_GR already blocks
 * Every failure becomes its own exception; an item passes only if all checks pass.
 */
const { Ratio } = require('./decimal')
const { selectRule, checkPrice, checkQuantity } = require('./tolerance')

const RESPONSIBLE_ROLE = Object.freeze({
  PRICE_VARIANCE: 'BUYER',
  QTY_VARIANCE: 'BUYER',
  NO_GR: 'BUYER',
  DUPLICATE_SUSPECT: 'AP_MANAGER'
})

/**
 * @param {object} input
 * @param {object} input.invoice            { ID, companyCode, currency_code, invoiceDate, grossAmount,
 *                                            normalizedReference, items: [{ ID, itemNo, purchaseOrderItem, quantity, unitPrice }] }
 * @param {object} input.purchaseOrder      facade PurchaseOrder with items
 * @param {object[]} input.receivedQuantities facade ReceivedQuantity rows (net per PO item)
 * @param {object[]} input.invoicedQuantities { purchaseOrderItem, quantity } on OTHER non-cancelled invoices
 * @param {object[]} input.toleranceRules   all tolerance rules
 * @param {object|null} input.approvalPolicy policy of the invoice's company code
 * @param {object[]} input.possibleDuplicates other non-cancelled invoices of the same supplier and
 *                                            invoice date: { ID, invoiceNumber, normalizedReference, grossAmount }
 * @returns {{ items: object[], exceptions: object[], outcome: object, warnings: object[] }}
 */
function evaluateInvoice(input) {
  const { invoice, purchaseOrder: po } = input
  const warnings = []

  const ruleFor = varianceType => {
    const selection = selectRule(input.toleranceRules, {
      companyCode: invoice.companyCode, varianceType, onDate: String(invoice.invoiceDate), currency: invoice.currency_code
    })
    warnings.push(...selection.warnings)
    return selection
  }
  const priceRule = ruleFor('PRICE')
  const quantityRule = ruleFor('QUANTITY')

  // Quantities already invoiced per PO item: other invoices, then earlier lines of this one.
  const invoiced = new Map()
  for (const { purchaseOrderItem, quantity } of input.invoicedQuantities)
    invoiced.set(purchaseOrderItem, (invoiced.get(purchaseOrderItem) ?? Ratio.of(0)).plus(quantity))

  const items = [], exceptions = []
  for (const item of [...invoice.items].sort((a, b) => a.itemNo - b.itemNo)) {
    const poItem = po.items.find(i => i.item === item.purchaseOrderItem)
    if (!poItem) throw new Error(`PO item ${item.purchaseOrderItem} not found on PO ${po.purchaseOrder}`) // caller re-validates first
    const received = input.receivedQuantities.find(r => r.purchaseOrderItem === item.purchaseOrderItem)
    const result = evaluateItem({
      item, poItem,
      netReceived: Ratio.of(received?.receivedQuantity ?? 0),
      previouslyInvoiced: invoiced.get(item.purchaseOrderItem) ?? Ratio.of(0),
      priceRule, quantityRule
    })
    invoiced.set(item.purchaseOrderItem, (invoiced.get(item.purchaseOrderItem) ?? Ratio.of(0)).plus(item.quantity))
    items.push(result)
    for (const failure of result.failures)
      exceptions.push({
        type: failure.type,
        responsibleRole: RESPONSIBLE_ROLE[failure.type],
        invoiceItemID: item.ID,
        purchasingGroup: po.purchasingGroup,
        varianceAmount: failure.varianceAmount
      })
  }

  // D3 suspect duplicate: same supplier, date and gross amount, different reference.
  for (const other of input.possibleDuplicates) {
    if (other.normalizedReference === invoice.normalizedReference) continue
    if (Ratio.of(other.grossAmount).compare(invoice.grossAmount) !== 0) continue
    exceptions.push({
      type: 'DUPLICATE_SUSPECT',
      responsibleRole: RESPONSIBLE_ROLE.DUPLICATE_SUSPECT,
      invoiceItemID: null,
      relatedInvoiceID: other.ID,
      purchasingGroup: po.purchasingGroup,
      varianceAmount: Ratio.of(invoice.grossAmount).toFixed(2)
    })
  }

  const outcome = decideOutcome({ invoice, hasExceptions: exceptions.length > 0, policy: input.approvalPolicy })
  warnings.push(...outcome.warnings)
  return { items: items.map(({ failures, ...row }) => row), exceptions, outcome: { status: outcome.status, approvalReason: outcome.approvalReason }, warnings }
}

/** Evaluates one invoice item; returns the MatchResults snapshot plus its failures. */
function evaluateItem({ item, poItem, netReceived, previouslyInvoiced, priceRule, quantityRule }) {
  const poUnitPrice = Ratio.of(poItem.netPrice).dividedBy(poItem.priceUnit)
  const invoicedQuantity = Ratio.of(item.quantity)
  const failures = []

  // 1. price
  const price = checkPrice({ invoicedUnitPrice: item.unitPrice, poUnitPrice, invoicedQuantity, limits: priceRule.limits })
  if (!price.passes) failures.push({ type: 'PRICE_VARIANCE', varianceAmount: price.amount.abs().toFixed(2) })

  // 2. goods receipt (3-way items only)
  const noGoodsReceipt = poItem.grBasedIV && netReceived.sign() <= 0
  if (noGoodsReceipt)
    failures.push({ type: 'NO_GR', varianceAmount: invoicedQuantity.times(item.unitPrice).toFixed(2) })

  // 3. quantity: open = (GR-based ? net received : ordered) − already invoiced
  const available = poItem.grBasedIV ? netReceived : Ratio.of(poItem.orderQuantity)
  const open = available.minus(previouslyInvoiced)
  const quantity = checkQuantity({ invoicedQuantity, openQuantity: open, poUnitPrice, limits: quantityRule.limits })
  if (!noGoodsReceipt && !quantity.passes)
    failures.push({ type: 'QTY_VARIANCE', varianceAmount: quantity.value.abs().toFixed(2) })

  return {
    invoiceItemID: item.ID,
    result: failures[0]?.type ?? 'PASS',
    matchStatus: failures.length ? 'VARIANCE' : 'MATCHED',
    poQuantity: Ratio.of(poItem.orderQuantity).toFixed(3),
    poUnitPrice: poUnitPrice.toFixed(4),
    receivedQuantity: poItem.grBasedIV ? netReceived.toFixed(3) : '0.000', // 0 for 2-way items
    previouslyInvoicedQty: previouslyInvoiced.toFixed(3),
    invoicedQuantity: invoicedQuantity.toFixed(3),
    invoicedUnitPrice: Ratio.of(item.unitPrice).toFixed(2),
    priceVariancePct: price.pct?.toFixed(4) ?? null,
    priceVarianceAmount: price.amount.toFixed(2),
    quantityVariance: quantity.excess.toFixed(3),
    appliedPriceRuleID: priceRule.rule?.ID ?? null,
    appliedQtyRuleID: quantityRule.rule?.ID ?? null,
    failures
  }
}

/**
 * Invoice outcome: any exception -> EXCEPTION; otherwise MATCHED, unless the gross amount
 * is above the company's auto-release limit -> PENDING_APPROVAL. Without a usable policy
 * (none, or in another currency) the safe answer is PENDING_APPROVAL with a warning.
 */
function decideOutcome({ invoice, hasExceptions, policy }) {
  if (hasExceptions) return { status: 'EXCEPTION', approvalReason: null, warnings: [] }
  if (!policy)
    return { status: 'PENDING_APPROVAL', approvalReason: 'NO_APPROVAL_POLICY', warnings: [{ code: 'NO_APPROVAL_POLICY', args: [invoice.companyCode] }] }
  if (policy.currency_code !== invoice.currency_code)
    return {
      status: 'PENDING_APPROVAL', approvalReason: 'POLICY_CURRENCY_MISMATCH',
      warnings: [{ code: 'APPROVAL_POLICY_CURRENCY_MISMATCH', args: [invoice.companyCode, policy.currency_code, invoice.currency_code] }]
    }
  if (Ratio.of(invoice.grossAmount).compare(policy.autoReleaseLimit) > 0)
    return { status: 'PENDING_APPROVAL', approvalReason: 'OVER_AUTO_RELEASE_LIMIT', warnings: [] }
  return { status: 'MATCHED', approvalReason: null, warnings: [] }
}

module.exports = { evaluateInvoice, evaluateItem, decideOutcome, RESPONSIBLE_ROLE }
