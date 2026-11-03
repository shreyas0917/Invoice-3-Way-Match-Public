// Phase 3: submission validation V1-V10, duplicate detection D1/D2/D4, numbering,
// snapshots and the checkDuplicates function - all through OData, as Fiori calls them.
// Fixtures: test/data (submitted invoices) + mock-data/s4mock (MOCK S/4 data).
const cds = require('@sap/cds')
const path = require('path')

const { GET, POST, PATCH, data, axios } = cds.test(path.join(__dirname, '../..'))
// Since phase 5 Invoices carry an ETag: writes need If-Match (428 otherwise). Fiori sends it on
// every write; '*' stands in for it here. Stale-ETag behaviour is tested in status-machine tests.
axios.defaults.headers['If-Match'] = '*'

const BASE = '/odata/v4/invoice'
const AS_CLERK = { auth: { username: 'clerk1', password: '' } }
const draftOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=false)`
const activeOf = id => `${BASE}/Invoices(ID=${id},IsActiveEntity=true)`

// A valid invoice against MOCK PO 4500000101 (supplier 1000010, 1010, INR, ordered 2026-09-01).
const VALID_HEADER = {
  supplierID: '1000010',
  supplierReference: 'INV-0100',
  invoiceDate: '2026-10-15',
  companyCode: '1010',
  purchaseOrder: '4500000101',
  currency_code: 'INR',
  netAmount: 30000,
  taxAmount: 5400,
  grossAmount: 35400
}
const VALID_ITEM = { purchaseOrderItem: '00010', quantity: 20, unit: 'EA', unitPrice: 1500, netAmount: 30000 }

/** Creates a draft with the given header and items; returns its ID. */
async function draft(header = {}, items = [VALID_ITEM]) {
  const { data: created } = await POST(`${BASE}/Invoices`, {}, AS_CLERK)
  await PATCH(draftOf(created.ID), { ...VALID_HEADER, ...header }, AS_CLERK)
  for (const item of items) await POST(`${draftOf(created.ID)}/items`, item, AS_CLERK)
  return created.ID
}

/** Save = draft activation. Resolves with the active invoice. */
const save = id => POST(`${draftOf(id)}/InvoiceService.draftActivate`, {}, AS_CLERK).then(r => r.data)

/** Saves and expects a rejection; returns { status, errors: [{ code, target, message }] }. */
async function saveRejected(id) {
  const response = await save(id).then(
    () => { throw new Error('expected the save to be rejected') },
    error => error.response
  )
  const { error } = response.data
  const errors = error.details?.length ? error.details : [error]
  return { status: response.status, errors: errors.map(({ code, target, message }) => ({ code, target, message })) }
}

const codes = result => result.errors.map(e => e.code).sort()
// Message targets are relative to the action's binding parameter 'in' (the invoice draft).
const itemTarget = (id, field) => expect.stringMatching(new RegExp(`^in/items\\(ID=[0-9a-f-]+,IsActiveEntity=false\\)/${field}$`))

beforeEach(data.reset)

describe('successful submission', () => {
  test('a valid invoice becomes VALIDATED with number, fiscal year, snapshots and normalised reference', async () => {
    const id = await draft({ supplierReference: 'inv-0100/a' })
    const saved = await save(id)
    expect(saved).toMatchObject({
      IsActiveEntity: true,
      status: 'VALIDATED',
      invoiceNumber: 'INV-2026-000003', // test/data already holds 000001 and 000002
      fiscalYear: '2026',
      supplierName: 'MOCK Acme Industrial Supplies',
      purchasingGroup: '001',
      supplierReference: 'inv-0100/a',
      normalizedReference: 'INV100A'
    })
  })

  test('invoice numbers continue per fiscal year and are kept when an invoice is edited again', async () => {
    const first = await save(await draft({ supplierReference: 'A-1' }))
    const second = await save(await draft({ supplierReference: 'A-2' }))
    expect([first.invoiceNumber, second.invoiceNumber]).toEqual(['INV-2026-000003', 'INV-2026-000004'])

    await POST(`${activeOf(first.ID)}/InvoiceService.draftEdit`, { PreserveChanges: true }, AS_CLERK)
    await PATCH(draftOf(first.ID), { taxAmount: 5000, grossAmount: 35000 }, AS_CLERK)
    const edited = await save(first.ID)
    expect(edited).toMatchObject({ invoiceNumber: 'INV-2026-000003', status: 'VALIDATED' })
  })

  test('amount tolerances of ± 0.01 are inclusive (V1, V3)', async () => {
    const id = await draft(
      { netAmount: 30000.01, taxAmount: 5400, grossAmount: 35400.02 }, // gross off by 0.01
      [{ ...VALID_ITEM, netAmount: 30000.01 }] // 20 × 1500 = 30000.00, off by 0.01
    )
    await expect(save(id)).resolves.toMatchObject({ status: 'VALIDATED' })
  })

  test('decimal arithmetic is exact: 3 × 0.10 equals 0.30', async () => {
    const id = await draft(
      { purchaseOrder: '4500000103', supplierID: '1000020', netAmount: 0.3, taxAmount: 0, grossAmount: 0.3 },
      [{ purchaseOrderItem: '00010', quantity: 3, unit: 'EA', unitPrice: 0.1, netAmount: 0.3 }]
    )
    await expect(save(id)).resolves.toMatchObject({ status: 'VALIDATED' })
  })
})

describe('failed submission', () => {
  test('stays an editable draft with field-level messages, and nothing is activated', async () => {
    const id = await draft({ grossAmount: 35500 })
    const result = await saveRejected(id)
    expect(result.status).toBe(400)

    await expect(GET(activeOf(id), AS_CLERK)).rejects.toMatchObject({ response: { status: 404 } })
    const { data: stillDraft } = await GET(`${draftOf(id)}?$select=status,invoiceNumber,fiscalYear,DraftMessages`, AS_CLERK)
    expect(stillDraft).toMatchObject({ IsActiveEntity: false, status: null, invoiceNumber: null, fiscalYear: null })
    expect(stillDraft.DraftMessages).toEqual([
      expect.objectContaining({ code: 'INVOICE_GROSS_MISMATCH', target: `/Invoices(ID=${id},IsActiveEntity=false)/grossAmount` })
    ])

    // the clerk fixes the field and saves again
    await PATCH(draftOf(id), { grossAmount: 35400 }, AS_CLERK)
    await expect(save(id)).resolves.toMatchObject({ status: 'VALIDATED' })
  })

  test('several errors are reported together, each on its own field', async () => {
    const id = await draft({ companyCode: '1020', currency_code: 'EUR', grossAmount: 1 })
    const result = await saveRejected(id)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVOICE_GROSS_MISMATCH', target: 'in/grossAmount' }),
      expect.objectContaining({ code: 'COMPANY_CODE_MISMATCH', target: 'in/companyCode' }),
      expect.objectContaining({ code: 'CURRENCY_MISMATCH', target: 'in/currency_code' })
    ]))
  })

  test('messages come from the i18n file with their values filled in', async () => {
    const result = await saveRejected(await draft({ grossAmount: 35500 }))
    expect(result.errors[0].message).toBe('Gross amount 35500.00 must equal net amount plus tax (35400.00), within 0.01.')
  })

  test('declarative checks: mandatory fields and positive quantities', async () => {
    const id = await draft({ supplierReference: null }, [{ ...VALID_ITEM, quantity: 0, netAmount: 0 }])
    const result = await saveRejected(id)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSERT_MANDATORY', target: 'in/supplierReference' }),
      { code: 'ASSERT_RANGE', target: itemTarget(id, 'quantity'), message: 'The quantity must be greater than 0.' } // CAP's code; our text
    ]))
  })
})

describe('V1-V3 amounts and items', () => {
  test('V1 gross amount must equal net + tax', async () => {
    const result = await saveRejected(await draft({ grossAmount: 35401 }))
    expect(result).toMatchObject({ status: 400, errors: [{ code: 'INVOICE_GROSS_MISMATCH', target: 'in/grossAmount' }] })
  })

  test('V2 net amount must equal the sum of the items', async () => {
    const result = await saveRejected(await draft({ netAmount: 30000.02, grossAmount: 35400.02 }))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'INVOICE_NET_MISMATCH', target: 'in/netAmount' })])
  })

  test('V3 item net amount must equal quantity × unit price', async () => {
    const id = await draft(
      { netAmount: 30000.02, grossAmount: 35400.02 },
      [{ ...VALID_ITEM, netAmount: 30000.02 }]
    )
    const result = await saveRejected(id)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'ITEM_NET_AMOUNT_MISMATCH', target: itemTarget(id, 'netAmount') })])
  })

  test('V3 an invoice needs at least one item', async () => {
    const result = await saveRejected(await draft({}, []))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'INVOICE_NO_ITEMS', target: 'in/items' })])
  })

  test('V3 item numbers must be unique', async () => {
    const id = await draft(
      { netAmount: 31500, taxAmount: 0, grossAmount: 31500 },
      [{ ...VALID_ITEM, itemNo: 1 }, { ...VALID_ITEM, itemNo: 1, quantity: 1, netAmount: 1500 }]
    )
    const result = await saveRejected(id)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'ITEM_NUMBER_DUPLICATE', target: itemTarget(id, 'itemNo') })])
  })
})

describe('V4-V10 against MOCK S/4 data (through the facade)', () => {
  const rejectedWith = async (header, items) => codes(await saveRejected(await draft(header, items)))

  test('V4 unknown supplier', async () => {
    expect(await rejectedWith({ supplierID: '9999999' })).toEqual(['PO_SUPPLIER_MISMATCH', 'SUPPLIER_NOT_FOUND'])
  })

  test('V4 posting-blocked supplier', async () => {
    const header = { supplierID: '1000050', purchaseOrder: '4500000106', netAmount: 2500, taxAmount: 0, grossAmount: 2500 }
    const items = [{ purchaseOrderItem: '00010', quantity: 10, unit: 'EA', unitPrice: 250, netAmount: 2500 }]
    expect(await rejectedWith(header, items)).toEqual(['SUPPLIER_POSTING_BLOCKED'])
  })

  test('V5 unknown purchase order', async () => {
    expect(await rejectedWith({ purchaseOrder: '4599999999' })).toEqual(['PO_NOT_FOUND'])
  })

  test('V5 deleted purchase order', async () => {
    expect(await rejectedWith({ supplierID: '1000020', purchaseOrder: '4500000107' })).toEqual(['PO_DELETED'])
  })

  test('V6 PO supplier must match the invoice supplier', async () => {
    const result = await saveRejected(await draft({ supplierID: '1000020' }))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'PO_SUPPLIER_MISMATCH', target: 'in/supplierID' })])
  })

  test('V7 PO company code must match', async () => {
    expect(await rejectedWith({ companyCode: '1020' })).toEqual(['COMPANY_CODE_MISMATCH'])
  })

  test('V8 invoice currency must equal PO currency', async () => {
    expect(await rejectedWith({ currency_code: 'EUR' })).toEqual(['CURRENCY_MISMATCH'])
  })

  test('V9 PO item must exist on the PO', async () => {
    const id = await draft({}, [{ ...VALID_ITEM, purchaseOrderItem: '00099' }])
    const result = await saveRejected(id)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'PO_ITEM_NOT_FOUND', target: itemTarget(id, 'purchaseOrderItem') })])
  })

  test('V9 PO item must not be deleted', async () => {
    const header = { supplierID: '1000030', purchaseOrder: '4500000104', companyCode: '1020', netAmount: 700, taxAmount: 0, grossAmount: 700 }
    const items = [{ purchaseOrderItem: '00020', quantity: 10, unit: 'KG', unitPrice: 70, netAmount: 700 }]
    expect(await rejectedWith(header, items)).toEqual(['PO_ITEM_DELETED'])
  })

  test('V9 unit must equal the PO item unit', async () => {
    const id = await draft({}, [{ ...VALID_ITEM, unit: 'KG' }])
    const result = await saveRejected(id)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'ITEM_UNIT_MISMATCH', target: itemTarget(id, 'unit') })])
  })

  test('V10 invoice date must not be in the future', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const result = await saveRejected(await draft({ invoiceDate: tomorrow }))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'INVOICE_DATE_IN_FUTURE', target: 'in/invoiceDate' })])
  })

  test('V10 invoice date must not be before the PO order date', async () => {
    const result = await saveRejected(await draft({ invoiceDate: '2026-08-31' }))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'INVOICE_DATE_BEFORE_PO_DATE', target: 'in/invoiceDate' })])
  })
})

describe('duplicate detection', () => {
  const countInvoices = async () => (await GET(`${BASE}/Invoices/$count`, AS_CLERK)).data

  test('D1 an exact duplicate is rejected with 409 naming the existing invoice; no second invoice is created', async () => {
    const before = await countInvoices()
    const id = await draft({ supplierReference: 'INV-0045' })
    const result = await saveRejected(id)
    expect(result).toMatchObject({ status: 409, errors: [{ code: 'DUPLICATE_INVOICE', target: 'in/supplierReference' }] })
    expect(result.errors[0].message).toContain('INV-2026-000001')

    expect(await countInvoices()).toBe(before)
    const { data: stillDraft } = await GET(draftOf(id), AS_CLERK)
    expect(stillDraft).toMatchObject({ IsActiveEntity: false, invoiceNumber: null })
  })

  test.each(['inv-0045', 'INV 45', 'INV/45', 'INV.0045', 'inv 00045'])(
    'D2 reference %p collides with INV-0045 after normalisation', async reference => {
      const result = await saveRejected(await draft({ supplierReference: reference }))
      expect(result).toMatchObject({ status: 409, errors: [{ code: 'DUPLICATE_INVOICE' }] })
    })

  test('D1 the same reference from another supplier is not a duplicate', async () => {
    const header = { supplierID: '1000020', purchaseOrder: '4500000103', supplierReference: 'INV-0045', netAmount: 450, taxAmount: 0, grossAmount: 450 }
    const items = [{ purchaseOrderItem: '00010', quantity: 100, unit: 'EA', unitPrice: 4.5, netAmount: 450 }]
    await expect(save(await draft(header, items))).resolves.toMatchObject({ status: 'VALIDATED' })
  })

  test('D4 a cancelled invoice with the same reference does not block resubmission', async () => {
    const saved = await save(await draft({ supplierReference: 'CXL-0007' }))
    expect(saved).toMatchObject({ status: 'VALIDATED', normalizedReference: 'CXL7' })
  })

  test('D1 two new invoices with the same reference: the second one is blocked', async () => {
    await save(await draft({ supplierReference: 'NEW-1' }))
    const result = await saveRejected(await draft({ supplierReference: 'new 01' }))
    expect(result).toMatchObject({ status: 409, errors: [{ code: 'DUPLICATE_INVOICE' }] })
  })
})

describe('checkDuplicates function', () => {
  const check = async ({ supplierID, supplierReference, invoiceDate, grossAmount }) => {
    const { data } = await GET(`${BASE}/checkDuplicates(supplierID='${supplierID}',supplierReference='${encodeURIComponent(supplierReference)}',invoiceDate=${invoiceDate},grossAmount=${grossAmount})`, AS_CLERK)
    return data.value
  }

  test('finds an invoice with the same normalised reference in the same fiscal year', async () => {
    const result = await check({ supplierID: '1000010', supplierReference: 'inv 45', invoiceDate: '2026-10-20', grossAmount: 1 })
    expect(result).toEqual([{
      ID: '11111111-0000-4000-8000-000000000001',
      invoiceNumber: 'INV-2026-000001',
      supplierReference: 'INV-0045',
      invoiceDate: '2026-10-01',
      grossAmount: '17700.00', // Decimal is serialised as a string, like entity fields
      currency_code: 'INR',
      status: 'VALIDATED',
      reason: 'SAME_REFERENCE'
    }])
  })

  test('finds an invoice with a different reference but the same date and gross amount', async () => {
    const result = await check({ supplierID: '1000010', supplierReference: 'OTHER-9', invoiceDate: '2026-10-01', grossAmount: '17700.00' })
    expect(result.map(r => [r.invoiceNumber, r.reason])).toEqual([['INV-2026-000001', 'SAME_DATE_AND_AMOUNT']])
  })

  test('ignores cancelled invoices and other suppliers, and changes no data', async () => {
    const before = (await GET(`${BASE}/Invoices/$count`, AS_CLERK)).data
    expect(await check({ supplierID: '1000010', supplierReference: 'CXL-0007', invoiceDate: '2026-10-20', grossAmount: 1 })).toEqual([])
    expect(await check({ supplierID: '1000020', supplierReference: 'INV-0045', invoiceDate: '2026-10-20', grossAmount: 1 })).toEqual([])
    expect((await GET(`${BASE}/Invoices/$count`, AS_CLERK)).data).toBe(before)
  })
})
