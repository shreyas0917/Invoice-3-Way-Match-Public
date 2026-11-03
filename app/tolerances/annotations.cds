/**
 * UI annotations for Tolerance Configuration (AP Manager): AdminService.ToleranceRules
 * (draft) and AdminService.ApprovalPolicies. The matching engine (srv/lib/tolerance.js)
 * stays the only place where rules are applied; this app only maintains them.
 */
using AdminService as service from '../../srv/admin-service';

annotate service.ToleranceRules with @(
  UI.HeaderInfo: {
    TypeName      : 'Tolerance Rule',
    TypeNamePlural: 'Tolerance Rules',
    Title         : { Value: varianceType },
    Description   : { Value: companyCode }
  },

  UI.SelectionFields: [ companyCode, varianceType, isActive, validFrom, validTo ],

  UI.LineItem: [
    { Value: companyCode, Label: 'Company Code (empty = global)' },
    { Value: varianceType },
    { Value: upperPercent },
    { Value: lowerPercent },
    { Value: upperAbsolute },
    { Value: lowerAbsolute },
    { Value: validFrom },
    { Value: validTo },
    { Value: isActive }
  ],

  UI.PresentationVariant: {
    SortOrder     : [{ Property: companyCode }, { Property: varianceType }, { Property: validFrom, Descending: true }],
    Visualizations: ['@UI.LineItem']
  },
  // Tab of the list report (manifest "views": rules and policies side by side).
  UI.SelectionPresentationVariant #Rules: {
    Text: 'Tolerance Rules',
    SelectionVariant   : { SelectOptions: [] },
    PresentationVariant: ![@UI.PresentationVariant]
  },

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'Identity', Label: 'Rule Identity', Target: '@UI.FieldGroup#Identity' },
    { $Type: 'UI.ReferenceFacet', ID: 'Limits', Label: 'Tolerance Limits', Target: '@UI.FieldGroup#Limits' },
    { $Type: 'UI.ReferenceFacet', ID: 'Validity', Label: 'Validity', Target: '@UI.FieldGroup#Validity' },
    { $Type: 'UI.ReferenceFacet', ID: 'HowApplied', Label: 'How Rules Are Applied', Target: '@UI.FieldGroup#HowApplied' }
  ],
  UI.FieldGroup #Identity: { Data: [
    { Value: companyCode },
    { Value: varianceType }
  ]},
  UI.FieldGroup #Limits: { Data: [
    { Value: upperPercent },
    { Value: lowerPercent },
    { Value: upperAbsolute },
    { Value: lowerAbsolute },
    { Value: currency_code }
  ]},
  UI.FieldGroup #Validity: { Data: [
    { Value: validFrom },
    { Value: validTo },
    { Value: isActive }
  ]},
  UI.FieldGroup #HowApplied: { Data: [
    { Value: howRulesApply, Label: ' ' }
  ]}
);

annotate service.ApprovalPolicies with @(
  UI.HeaderInfo: {
    TypeName      : 'Approval Policy',
    TypeNamePlural: 'Approval Policies',
    Title         : { Value: companyCode },
    Description   : { Value: autoReleaseLimit }
  },
  UI.SelectionFields: [ companyCode ],
  UI.LineItem: [
    { Value: companyCode },
    { Value: autoReleaseLimit },
    { Value: currency_code }
  ],
  UI.PresentationVariant: {
    SortOrder     : [{ Property: companyCode }],
    Visualizations: ['@UI.LineItem']
  },
  UI.SelectionPresentationVariant #Policies: {
    Text: 'Approval Policies (Auto-Release Limits)',
    SelectionVariant   : { SelectOptions: [] },
    PresentationVariant: ![@UI.PresentationVariant]
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'Policy', Label: 'Auto-Release', Target: '@UI.FieldGroup#Policy' }
  ],
  UI.FieldGroup #Policy: { Data: [
    { Value: companyCode },
    { Value: autoReleaseLimit },
    { Value: currency_code }
  ]}
);
