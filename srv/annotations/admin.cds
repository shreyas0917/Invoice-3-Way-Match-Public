/**
 * Shared annotations for AdminService: labels, value helps and texts.
 * UI layout lives in app/tolerances/annotations.cds and app/integration-log/annotations.cds.
 */
using AdminService as service from '../admin-service';

annotate service.ToleranceRules with @title: 'Tolerance Rule' {
  ID            @UI.Hidden;
  companyCode   @title: 'Company Code' @Common.QuickInfo: 'Empty = global rule for all company codes';
  varianceType  @title: 'Variance Type' @Common.ValueListWithFixedValues @Common.ValueList: {
                  CollectionPath: 'VarianceTypes',
                  Parameters    : [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: varianceType, ValueListProperty: 'code' } ]
                };
  upperPercent  @title: 'Upper Limit %' @Common.QuickInfo: 'Highest allowed variance above the PO, in percent';
  lowerPercent  @title: 'Lower Limit %' @Common.QuickInfo: 'Highest allowed variance below the PO, in percent';
  upperAbsolute @title: 'Upper Limit Amount' @Measures.ISOCurrency: currency_code;
  lowerAbsolute @title: 'Lower Limit Amount' @Measures.ISOCurrency: currency_code;
  currency      @title: 'Currency of the Amount Limits';
  validFrom     @title: 'Valid From';
  validTo       @title: 'Valid To' @Common.QuickInfo: 'Inclusive; empty = open-ended';
  isActive      @title: 'Active';
  howRulesApply @title: 'How Rules Are Applied' @Core.Computed @UI.MultiLineText;
}

annotate service.ApprovalPolicies with @title: 'Approval Policy' {
  ID               @UI.Hidden;
  companyCode      @title: 'Company Code';
  autoReleaseLimit @title: 'Auto-Release Limit (gross)' @Measures.ISOCurrency: currency_code
                   @Common.QuickInfo: 'Fully matched invoices above this gross amount need AP Manager approval';
  currency         @title: 'Currency';
}

annotate service.MessageLog with @title: 'Integration Call' {
  ID            @UI.Hidden;
  createdAt     @title: 'Timestamp';
  correlationID @title: 'Correlation ID';
  direction     @title: 'Direction';
  targetSystem  @title: 'Target System';
  operation     @title: 'Operation';
  invoice       @title: 'Invoice ID';
  status        @title: 'Status' @Common.Criticality: statusCriticality;
  statusCriticality @UI.Hidden;
  durationMs    @title: 'Duration (ms)';
  errorMessage  @title: 'Error';
}
