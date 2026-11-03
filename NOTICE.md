# Notices

The MIT License in [`LICENSE`](LICENSE) covers only the **original material of this project**
(its source code, CDS models, tests, scripts, synthetic data and documentation). It grants no
rights to anything listed below.

## SAP materials (not included)

- **SAP API specifications** (`API_PURCHASEORDER_2`, `API_MATERIAL_DOCUMENT_SRV`,
  `API_BUSINESS_PARTNER`) and the CDS models generated from them are **not part of this
  repository**. Users obtain them from SAP with their own account, under the terms that apply to
  them - see [`docs/sap-api-setup.md`](docs/sap-api-setup.md). The adapter refers to field names of
  these publicly documented APIs in order to interoperate with them.
- **SAPUI5** is not included; the Fiori apps load it at runtime from SAP's CDN
  (`ui5.sap.com`) under SAP's terms.
- **Screenshots** in `docs/screenshots` show this project's applications as rendered by SAPUI5;
  the SAP Fiori visual design shown in them belongs to SAP.

## Dependencies

npm packages are not included in the repository; they are installed from the npm registry under
their own licenses (see `package.json` and `package-lock.json`). Among them, `@sap/cds`,
`@sap/cds-dk`, `@sap/xssec` and `@sap/approuter` are licensed by SAP under its own license terms
(for example the SAP Developer License Agreement), not under MIT.

## Trademarks

SAP, SAP S/4HANA, SAP BTP, SAP HANA, SAP Fiori and SAPUI5 are trademarks or registered trademarks
of SAP SE or its affiliates. This is an independent portfolio project, not affiliated with or
endorsed by SAP.

All mock data (suppliers prefixed `MOCK`, materials, purchase orders, invoices) is synthetic.
