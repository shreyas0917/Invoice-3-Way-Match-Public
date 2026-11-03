/**
 * MOCK implementation of ExternalPurchaseOrderService.
 *
 * Reads the simulated S/4HANA tables in the `s4mock` namespace (see mock-data/s4mock).
 * Nothing here talks to a real SAP system. The real adapter (phase 10) must return
 * exactly the same shapes, so callers never notice which one is running.
 *
 * Timeout, MessageLog and S4_UNAVAILABLE come from FacadeService (srv/external/facade-guard.js),
 * which wraps every operation below.
 *
 * MOCK failure simulation (this file only - never in the real adapter or the engine):
 *   cds.requires.ExternalPurchaseOrderService.mock.failureMode
 *     none     normal answers (default)
 *     timeout  the call never answers on its own; the guard's timeout aborts it
 *     error    the call fails with a simulated S/4 error
 * Read on every call, so it can be switched at runtime (tests, scripts/simulate-failure.js).
 */
const cds = require('@sap/cds')
const FacadeService = require('./facade-service')

module.exports = class MockPurchaseOrderService extends FacadeService {
  static targetSystem = 'S4_MOCK'

  init() {
    const { Suppliers, PurchaseOrders, PurchaseOrderItems, GoodsReceiptItems } = cds.entities('s4mock')

    // Failure simulation runs inside the guard (an `on` handler), so the timeout applies to it.
    this.on('*', async (req, next) => {
      const mode = cds.env.requires.ExternalPurchaseOrderService?.mock?.failureMode ?? 'none'
      if (mode === 'error') throw new Error('MOCK S/4 error: the simulated system answered with an internal error')
      if (mode === 'timeout') return hangUntilAborted(req.abortSignal)
      return next()
    })

    this.on('getSupplier', async req => {
      const { supplierID } = req.data
      const supplier = await SELECT.one.from(Suppliers).where({ supplierID })
      if (!supplier) return notFound(req, 'SUPPLIER_NOT_FOUND', supplierID)
      return supplier
    })

    this.on('getPurchaseOrder', async req => {
      const { purchaseOrder } = req.data
      const po = await SELECT.one.from(PurchaseOrders).where({ purchaseOrder })
      if (!po) return notFound(req, 'PO_NOT_FOUND', purchaseOrder)
      const items = await SELECT.from(PurchaseOrderItems).where({ up__purchaseOrder: purchaseOrder }).orderBy('item')
      return { ...toPurchaseOrderHeader(po), items: items.map(toPurchaseOrderItem) }
    })

    this.on('getReceivedQuantities', async req => {
      const { purchaseOrder } = req.data
      const items = await SELECT.from(PurchaseOrderItems).where({ up__purchaseOrder: purchaseOrder }).orderBy('item')
      if (!items.length) return notFound(req, 'PO_NOT_FOUND', purchaseOrder)
      const movements = await SELECT.from(GoodsReceiptItems).where({ purchaseOrder })
      return items.map(poItem => {
        // Summed in JS rather than SQL so the logic stays database-independent.
        const received = movements
          .filter(m => m.purchaseOrderItem === poItem.item)
          .reduce((sum, m) => sum + (m.movementType === '102' ? -1 : 1) * Number(m.quantity), 0)
        return {
          purchaseOrder,
          purchaseOrderItem: poItem.item,
          receivedQuantity: received,
          unit: poItem.orderUnit
        }
      })
    })

    this.on('searchSuppliers', async req => {
      const text = (req.data.text ?? '').trim()
      const query = SELECT.from(Suppliers).orderBy('supplierID')
      if (text) query.where`supplierID like ${'%' + text + '%'} or tolower(name) like ${'%' + text.toLowerCase() + '%'}`
      return query
    })

    this.on('searchPurchaseOrders', async req => {
      const text = (req.data.text ?? '').trim(), { supplierID } = req.data
      const query = SELECT.from(PurchaseOrders).orderBy('purchaseOrder')
      if (text) query.where`purchaseOrder like ${'%' + text + '%'}`
      if (supplierID) query.where({ supplier_supplierID: supplierID })
      const pos = await query
      return pos.map(po => ({ ...toPurchaseOrderHeader(po), items: [] }))
    })

    this.on('listPurchaseOrderItems', async req => {
      const { purchaseOrder } = req.data
      const po = await SELECT.one.from(PurchaseOrders).columns('purchaseOrder').where({ purchaseOrder })
      if (!po) return notFound(req, 'PO_NOT_FOUND', purchaseOrder)
      const items = await SELECT.from(PurchaseOrderItems).where({ up__purchaseOrder: purchaseOrder }).orderBy('item')
      return items.map(toPurchaseOrderItem)
    })

    return super.init()
  }
}

/** Maps a mock PO header row to the facade's PurchaseOrder type (without items). */
function toPurchaseOrderHeader(po) {
  return {
    purchaseOrder: po.purchaseOrder,
    supplierID: po.supplier_supplierID,
    companyCode: po.companyCode,
    purchasingGroup: po.purchasingGroup,
    currency: po.currency_code,
    orderDate: po.orderDate,
    isDeleted: !!po.isDeleted
  }
}

/** Maps a mock table row to the facade's PurchaseOrderItem type. */
function toPurchaseOrderItem(row) {
  return {
    purchaseOrder: row.up__purchaseOrder,
    item: row.item,
    material: row.material,
    description: row.description,
    orderQuantity: Number(row.orderQuantity),
    orderUnit: row.orderUnit,
    netPrice: Number(row.netPrice),
    priceUnit: Number(row.priceUnit),
    grBasedIV: !!row.grBasedIV,
    isDeleted: !!row.isDeleted
  }
}

/** Rejects with HTTP 404, a stable business code and its i18n text from messages.properties. */
function notFound(req, code, key) {
  return req.reject({ status: 404, code, message: code, args: [key] })
}

/** MOCK timeout: never answers; rejects as soon as the guard aborts the call (no timer left behind). */
function hangUntilAborted(signal) {
  return new Promise((_, reject) => {
    if (!signal) return // no guard: hang (cannot happen - FacadeService always installs it)
    if (signal.aborted) return reject(new Error('MOCK S/4 call aborted'))
    signal.addEventListener('abort', () => reject(new Error('MOCK S/4 call aborted')), { once: true })
  })
}
