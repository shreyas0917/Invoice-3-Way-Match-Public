/**
 * S/4HANA adapter: implements ExternalPurchaseOrderService over the official SAP APIs
 * (definitions in srv/external/specs, imported with `cds import` to srv/external/s4):
 *
 *   API_PURCHASEORDER_2     OData V4, 1.3.0   getPurchaseOrder, searchPurchaseOrders, listPurchaseOrderItems
 *   API_MATERIAL_DOCUMENT   OData V2, 1.3.0   getReceivedQuantities (with the PO items)
 *   API_BUSINESS_PARTNER    OData V2, 1.6.0   getSupplier, searchSuppliers
 *
 * All SAP field names stay in this file; callers get exactly the shapes of the facade contract
 * (srv/external/purchase-order-facade.cds), like from the mock. Read-only: only SELECTs.
 * Timeout, MessageLog, correlation ID and S4_UNAVAILABLE come from FacadeService (the guard).
 *
 * Where the SAP services run is CAP configuration, not code: with credentials/destination they
 * are remote (MessageLog target 'S4'); without, `cds serve` mocks them locally with
 * mock-data/s4api ('S4_CAP_MOCK'). Mapping decisions: docs/adr/0008-s4-api-adapter.md.
 */
const cds = require('@sap/cds')
const FacadeService = require('./facade-service')
const { Ratio } = require('../lib/decimal')

/** Facade key -> name of the required SAP service (cds.requires.<name>). */
const SAP_SERVICES = { po: 'API_PURCHASEORDER_2', md: 'API_MATERIAL_DOCUMENT', bp: 'API_BUSINESS_PARTNER' }

/** Goods movement types counted for the received quantity, with their sign. */
const COUNTED_MOVEMENTS = { 101: 1, 102: -1 }

/** Upper bound for value-help searches, so a broad search cannot pull a whole S/4 table. */
const SEARCH_LIMIT = 200

/** A response the adapter cannot map without guessing - fails the call for good (logged; 502 S4_DATA_UNSUPPORTED). */
class UnsupportedS4Data extends Error {
  constructor(code, detail) { super(detail); this.code = code; this.permanent = true } // guard: 502, logs "<code>: <detail>"
}

module.exports = class S4Adapter extends FacadeService {
  static targetSystem = 'S4'

  init() {
    const remote = checkConfiguration() // explicit startup error if the SAP APIs are not configured
    this.targetSystem = remote ? 'S4' : 'S4_CAP_MOCK'
    // Connected on first use, so CAP's local mocks are surely served by then.
    let connecting = null
    const sapServices = () => connecting ??= connectSapServices(remote).catch(error => { connecting = null; throw error })
    const run = async (api, query) => (await sapServices())[api].run(query)
    const { PurchaseOrder, A_MaterialDocumentItem, A_Supplier } = ENTITIES

    /** PO header with its items (one V4 request with $expand), or null if unknown. */
    const readPurchaseOrder = async purchaseOrder => {
      const po = await run('po', SELECT.one.from(PurchaseOrder)
        .columns(...PO_HEADER_FIELDS, { ref: ['_PurchaseOrderItem'], expand: PO_ITEM_FIELDS.map(f => ({ ref: [f] })) })
        .where({ PurchaseOrder: purchaseOrder }))
      if (!po) return null
      return { ...toPurchaseOrderHeader(po), items: (po._PurchaseOrderItem ?? []).map(toPurchaseOrderItem).sort(byItem) }
    }

    this.on('getSupplier', async req => {
      const { supplierID } = req.data
      const supplier = await run('bp', SELECT.one.from(A_Supplier).columns(...SUPPLIER_FIELDS).where({ Supplier: supplierID }))
      if (!supplier) return notFound(req, 'SUPPLIER_NOT_FOUND', supplierID)
      return toSupplier(supplier)
    })

    this.on('searchSuppliers', async req => {
      const text = (req.data.text ?? '').trim().toLowerCase()
      const query = SELECT.from(A_Supplier).columns(...SUPPLIER_FIELDS).orderBy('Supplier').limit(SEARCH_LIMIT)
      if (text) query.where`contains(tolower(Supplier), ${text}) or contains(tolower(SupplierName), ${text})`
      return (await run('bp', query)).map(toSupplier)
    })

    this.on('getPurchaseOrder', async req => {
      const { purchaseOrder } = req.data
      return await readPurchaseOrder(purchaseOrder) ?? notFound(req, 'PO_NOT_FOUND', purchaseOrder)
    })

    this.on('searchPurchaseOrders', async req => {
      const text = (req.data.text ?? '').trim(), { supplierID } = req.data
      const query = SELECT.from(PurchaseOrder).columns(...PO_HEADER_FIELDS).orderBy('PurchaseOrder').limit(SEARCH_LIMIT)
      if (text) query.where`contains(PurchaseOrder, ${text})`
      if (supplierID) query.where({ Supplier: supplierID })
      return (await run('po', query)).map(po => ({ ...toPurchaseOrderHeader(po), items: [] }))
    })

    this.on('listPurchaseOrderItems', async req => {
      const { purchaseOrder } = req.data
      const po = await readPurchaseOrder(purchaseOrder)
      if (!po) return notFound(req, 'PO_NOT_FOUND', purchaseOrder)
      return po.items
    })

    this.on('getReceivedQuantities', async req => {
      const { purchaseOrder } = req.data
      const [po, movements] = await Promise.all([
        readPurchaseOrder(purchaseOrder),
        run('md', SELECT.from(A_MaterialDocumentItem).columns(...MOVEMENT_FIELDS).where({ PurchaseOrder: purchaseOrder }))
      ])
      if (!po) return notFound(req, 'PO_NOT_FOUND', purchaseOrder)
      return receivedQuantities(po, movements)
    })

    return super.init()
  }
}

// --- SAP fields read (nothing else is requested) -------------------------------------------

const SUPPLIER_FIELDS = ['Supplier', 'SupplierName', 'PostingIsBlocked']
const PO_HEADER_FIELDS = ['PurchaseOrder', 'Supplier', 'CompanyCode', 'PurchasingGroup', 'DocumentCurrency',
  'PurchaseOrderDate', 'PurchaseOrderDeletionCode']
const PO_ITEM_FIELDS = ['PurchaseOrder', 'PurchaseOrderItem', 'Material', 'PurchaseOrderItemText', 'OrderQuantity',
  'PurchaseOrderQuantityUnit', 'NetPriceAmount', 'NetPriceQuantity', 'OrderPriceUnit', 'InvoiceIsGoodsReceiptBased',
  'PurchasingDocumentDeletionCode']
const MOVEMENT_FIELDS = ['MaterialDocumentYear', 'MaterialDocument', 'MaterialDocumentItem', 'GoodsMovementType',
  'PurchaseOrder', 'PurchaseOrderItem', 'QuantityInEntryUnit', 'EntryUnit', 'QuantityInBaseUnit', 'MaterialBaseUnit']

// --- Mapping: SAP -> facade contract (pure functions, unit-tested) --------------------------

/**
 * A_Supplier -> Supplier. `isPostingBlocked` is A_Supplier.PostingIsBlocked (central posting
 * block). `country` is null: A_Supplier has no country, and the API metadata does not define how
 * a supplier is linked to its business partner address (see ADR 0008) - it is not guessed.
 */
function toSupplier(s) {
  return { supplierID: s.Supplier, name: s.SupplierName ?? '', country: null, isPostingBlocked: s.PostingIsBlocked === true }
}

/** PurchaseOrder (V4) -> PurchaseOrder header. Any deletion code marks the PO as deleted. */
function toPurchaseOrderHeader(po) {
  return {
    purchaseOrder: po.PurchaseOrder,
    supplierID: po.Supplier,
    companyCode: po.CompanyCode,
    purchasingGroup: po.PurchasingGroup,
    currency: po.DocumentCurrency,
    orderDate: po.PurchaseOrderDate ?? null,
    isDeleted: !!po.PurchaseOrderDeletionCode
  }
}

/**
 * PurchaseOrderItem (V4) -> PurchaseOrderItem.
 * Price: SAP's NetPriceAmount is the price of NetPriceQuantity units of the OrderPriceUnit, which
 * is the facade's netPrice per priceUnit - as long as the order price unit is the order unit.
 * If it is not, the conversion would need factors whose direction the metadata does not specify,
 * so the item is refused instead of mapped wrongly.
 * Deleted: any PurchasingDocumentDeletionCode (e.g. deleted or blocked) - not invoiceable.
 */
function toPurchaseOrderItem(i) {
  const orderUnit = i.PurchaseOrderQuantityUnit
  if (i.OrderPriceUnit && i.OrderPriceUnit !== orderUnit)
    throw new UnsupportedS4Data('UNSUPPORTED_PRICE_UNIT', `PO ${i.PurchaseOrder} item ${i.PurchaseOrderItem}: price per ${i.OrderPriceUnit}, ordered in ${orderUnit}`)
  const priceUnit = Number(i.NetPriceQuantity)
  if (!(priceUnit > 0))
    throw new UnsupportedS4Data('INVALID_PRICE_UNIT', `PO ${i.PurchaseOrder} item ${i.PurchaseOrderItem}: price quantity ${i.NetPriceQuantity}`)
  return {
    purchaseOrder: i.PurchaseOrder,
    item: i.PurchaseOrderItem,
    material: i.Material ?? '',
    description: i.PurchaseOrderItemText ?? '',
    orderQuantity: Number(i.OrderQuantity),
    orderUnit,
    netPrice: Number(i.NetPriceAmount),
    priceUnit,
    grBasedIV: i.InvoiceIsGoodsReceiptBased === true,
    isDeleted: !!i.PurchasingDocumentDeletionCode
  }
}

/**
 * Material document items -> net received quantity per PO item (0 without receipts).
 * - 101 adds, 102 subtracts. A cancelled 101 (GoodsMovementIsCancelled) still counts: its
 *   cancellation is the 102 document, which is subtracted - skipping both sides avoids nothing
 *   but skipping only one would count the reversal twice.
 * - Each material document item counts once (keyed by year, document, item).
 * - Any other movement type on the PO (e.g. 122 return, 105/106 release from blocked stock)
 *   could change the received quantity; it is refused, never ignored or guessed.
 * - Quantity in the PO's order unit: the entry quantity if entered in the order unit, else the
 *   base quantity if the base unit is the order unit; otherwise refused.
 */
function receivedQuantities(po, movements) {
  const itemsByNumber = new Map(po.items.map(i => [i.item, i]))
  const net = new Map(po.items.map(i => [i.item, Ratio.of(0)]))
  const seen = new Set()
  for (const m of movements) {
    const key = `${m.MaterialDocumentYear}/${m.MaterialDocument}/${m.MaterialDocumentItem}`
    if (seen.has(key)) continue
    seen.add(key)
    const poItem = itemsByNumber.get(m.PurchaseOrderItem)
    if (!poItem) continue // not an item of this PO (cannot happen for a consistent PO)
    const sign = COUNTED_MOVEMENTS[m.GoodsMovementType]
    if (!sign) throw new UnsupportedS4Data('UNSUPPORTED_MOVEMENT_TYPE', `${m.GoodsMovementType} in material document ${key}`)
    const quantity = m.EntryUnit === poItem.orderUnit ? m.QuantityInEntryUnit
      : m.MaterialBaseUnit === poItem.orderUnit ? m.QuantityInBaseUnit
      : undefined
    if (quantity === undefined || quantity === null)
      throw new UnsupportedS4Data('UNSUPPORTED_UNIT', `material document ${key} in ${m.EntryUnit}, PO item ordered in ${poItem.orderUnit}`)
    net.set(poItem.item, net.get(poItem.item).plus(Ratio.of(quantity).times(sign)))
  }
  return po.items.map(i => ({
    purchaseOrder: po.purchaseOrder,
    purchaseOrderItem: i.item,
    receivedQuantity: Number(net.get(i.item).toFixed(3)),
    unit: i.orderUnit
  }))
}

// --- Configuration ---------------------------------------------------------------------------

/** Entity names in the imported SAP services, queried by name (resolved by each service). */
const ENTITIES = {
  PurchaseOrder: 'API_PURCHASEORDER_2.PurchaseOrder',
  A_MaterialDocumentItem: 'API_MATERIAL_DOCUMENT.A_MaterialDocumentItem',
  A_Supplier: 'API_BUSINESS_PARTNER.A_Supplier'
}

/**
 * Checks the configuration at startup and returns whether the SAP APIs are remote (they have
 * credentials) or local CAP mocks (none have). A missing service or a mix of both is an error with
 * a clear message - never a silent fallback to the mock implementation.
 */
function checkConfiguration(profiles = cds.env.profiles) {
  const names = Object.values(SAP_SERVICES)
  for (const name of names) if (!cds.env.requires[name]?.model)
    throw new Error(`S/4 adapter: cds.requires.${name} is not configured. Use the profile 's4-adapter' (CDS_ENV=s4-adapter) - see README "S/4 adapter".`)
  const remote = new Set(names.map(name => !!cds.env.requires[name].credentials))
  if (remote.size > 1) throw new Error(`S/4 adapter: ${names.join(', ')} must all have credentials (remote) or none (local CAP mocks).`)
  const isRemote = [...remote][0]
  if (!isRemote && profiles.includes('production'))
    throw new Error(`S/4 adapter: no credentials for ${names.join(', ')} in production - configure the SAP destinations (phase 11). Local mocks are never used in production.`)
  cds.log('s4-adapter').info(isRemote ? 'SAP APIs: remote' : 'SAP APIs: LOCAL CAP MOCKS (mock-data/s4api) - no S/4HANA system is called')
  return isRemote
}

/** Connects the three SAP services and checks CAP gave what the configuration says. */
async function connectSapServices(remote) {
  const sap = {}
  for (const [key, name] of Object.entries(SAP_SERVICES)) {
    const srv = await cds.connect.to(name)
    if ((srv instanceof cds.RemoteService) !== remote)
      throw new Error(remote ? `S/4 adapter: ${name} has credentials but is not remote.`
        : `S/4 adapter: ${name} has no credentials and is not mocked - start with 'cds watch' (or 'cds serve --with-mocks'), or configure credentials.`)
    sap[key] = srv
  }
  return sap
}

const byItem = (a, b) => a.item.localeCompare(b.item)

/** Rejects with HTTP 404 and the facade's business code, exactly like the mock. */
function notFound(req, code, key) {
  return req.reject({ status: 404, code, message: code, args: [key] })
}

module.exports.internals = { toSupplier, toPurchaseOrderHeader, toPurchaseOrderItem, receivedQuantities, checkConfiguration, UnsupportedS4Data, COUNTED_MOVEMENTS, SAP_SERVICES }
