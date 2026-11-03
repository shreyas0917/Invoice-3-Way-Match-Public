/**
 * Submission rules V1-V10 (blueprint workflow 2) as pure functions.
 *
 * Each function returns a list of issues: { code, field, itemID?, args }.
 *  - code:   stable message code, text in srv/_i18n/messages.properties
 *  - field:  element the issue belongs to ('items' for the item table itself)
 *  - itemID: set for item-level issues, so the caller can target the item row
 * The caller (srv/invoice-service.js) turns issues into req.error() calls.
 *
 * Missing values are skipped here: @mandatory in db/schema.cds reports them.
 * The "invoice date in the future" half of V10 is a declarative @assert on the entity.
 */
const { toScaled, abs, format } = require('./decimal')

const CENT = 1n // tolerance ± 0.01 at scale 2
const CENT_AT_SCALE_5 = 1000n // ± 0.01 when quantity (scale 3) × price (scale 2)

/** V1-V3: amounts and item structure. */
function checkAmounts(invoice) {
  const issues = []
  const items = invoice.items ?? []
  const net = toScaled(invoice.netAmount, 2)
  const tax = toScaled(invoice.taxAmount, 2)
  const gross = toScaled(invoice.grossAmount, 2)

  // V1 gross = net + tax (± 0.01)
  if (net !== null && tax !== null && gross !== null && abs(gross - (net + tax)) > CENT)
    issues.push({ code: 'INVOICE_GROSS_MISMATCH', field: 'grossAmount', args: [format(gross, 2), format(net + tax, 2)] })

  // V3 at least one item
  if (!items.length) issues.push({ code: 'INVOICE_NO_ITEMS', field: 'items', args: [] })

  // V3 item numbers unique
  const seen = new Set()
  for (const item of items) {
    if (item.itemNo == null) continue
    if (seen.has(item.itemNo))
      issues.push({ code: 'ITEM_NUMBER_DUPLICATE', field: 'itemNo', itemID: item.ID, args: [item.itemNo] })
    seen.add(item.itemNo)
  }

  // V3 each item net = quantity × unit price (± 0.01)
  let itemSum = 0n, allItemNets = items.length > 0
  for (const item of items) {
    const quantity = toScaled(item.quantity, 3)
    const price = toScaled(item.unitPrice, 2)
    const itemNet = toScaled(item.netAmount, 2)
    if (itemNet === null) allItemNets = false
    else itemSum += itemNet
    if (quantity === null || price === null || itemNet === null) continue
    const expected = quantity * price // scale 5
    if (abs(expected - itemNet * 1000n) > CENT_AT_SCALE_5)
      issues.push({
        code: 'ITEM_NET_AMOUNT_MISMATCH', field: 'netAmount', itemID: item.ID,
        args: [item.itemNo, format(itemNet, 2), format(roundDivide(expected, 1000n), 2)]
      })
  }

  // V2 header net = sum of item nets (± 0.01)
  if (net !== null && allItemNets && abs(net - itemSum) > CENT)
    issues.push({ code: 'INVOICE_NET_MISMATCH', field: 'netAmount', args: [format(net, 2), format(itemSum, 2)] })

  return issues
}

/**
 * V4-V10: the invoice against S/4 data read through ExternalPurchaseOrderService.
 * @param invoice  the invoice with items
 * @param supplier facade Supplier, or null if it does not exist
 * @param po       facade PurchaseOrder with items, or null if it does not exist
 */
function checkAgainstPurchaseOrder(invoice, supplier, po) {
  const issues = []
  const items = invoice.items ?? []

  // V4 supplier exists and is not posting-blocked
  if (invoice.supplierID) {
    if (!supplier) issues.push({ code: 'SUPPLIER_NOT_FOUND', field: 'supplierID', args: [invoice.supplierID] })
    else if (supplier.isPostingBlocked) issues.push({ code: 'SUPPLIER_POSTING_BLOCKED', field: 'supplierID', args: [invoice.supplierID] })
  }

  // V5 PO exists and is not deleted; without a usable PO the remaining checks are meaningless
  if (!invoice.purchaseOrder) return issues
  if (!po) return [...issues, { code: 'PO_NOT_FOUND', field: 'purchaseOrder', args: [invoice.purchaseOrder] }]
  if (po.isDeleted) return [...issues, { code: 'PO_DELETED', field: 'purchaseOrder', args: [po.purchaseOrder] }]

  // V6 PO supplier = invoice supplier
  if (invoice.supplierID && po.supplierID !== invoice.supplierID)
    issues.push({ code: 'PO_SUPPLIER_MISMATCH', field: 'supplierID', args: [invoice.supplierID, po.purchaseOrder, po.supplierID] })

  // V7 PO company code = invoice company code
  if (invoice.companyCode && po.companyCode !== invoice.companyCode)
    issues.push({ code: 'COMPANY_CODE_MISMATCH', field: 'companyCode', args: [invoice.companyCode, po.purchaseOrder, po.companyCode] })

  // V8 invoice currency = PO currency
  if (invoice.currency_code && po.currency !== invoice.currency_code)
    issues.push({ code: 'CURRENCY_MISMATCH', field: 'currency_code', args: [invoice.currency_code, po.purchaseOrder, po.currency] })

  // V9 each item's PO item exists on that PO, is not deleted, and has the same unit
  for (const item of items) {
    if (!item.purchaseOrderItem) continue
    const poItem = po.items?.find(i => i.item === item.purchaseOrderItem)
    if (!poItem)
      issues.push({ code: 'PO_ITEM_NOT_FOUND', field: 'purchaseOrderItem', itemID: item.ID, args: [item.purchaseOrderItem, po.purchaseOrder] })
    else if (poItem.isDeleted)
      issues.push({ code: 'PO_ITEM_DELETED', field: 'purchaseOrderItem', itemID: item.ID, args: [item.purchaseOrderItem, po.purchaseOrder] })
    else if (item.unit && item.unit !== poItem.orderUnit)
      issues.push({ code: 'ITEM_UNIT_MISMATCH', field: 'unit', itemID: item.ID, args: [item.unit, item.purchaseOrderItem, poItem.orderUnit] })
  }

  // V10 invoice date not before the PO order date (ISO dates compare as strings)
  if (invoice.invoiceDate && po.orderDate && String(invoice.invoiceDate) < String(po.orderDate))
    issues.push({ code: 'INVOICE_DATE_BEFORE_PO_DATE', field: 'invoiceDate', args: [invoice.invoiceDate, po.purchaseOrder, po.orderDate] })

  return issues
}

/** Integer division rounding half away from zero. */
function roundDivide(numerator, divisor) {
  const quotient = numerator / divisor, remainder = numerator % divisor
  if (abs(remainder) * 2n >= divisor) return quotient + (numerator < 0n ? -1n : 1n)
  return quotient
}

module.exports = { checkAmounts, checkAgainstPurchaseOrder }
