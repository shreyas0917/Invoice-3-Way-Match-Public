/**
 * Code lists: fixed value sets with display texts.
 * Fields in db/schema.cds keep the plain String codes the blueprint specifies;
 * these entities add the human-readable name and the UI criticality colour.
 */
namespace ap;

using { sap.common.CodeList } from '@sap/cds/common';

/** The 8 invoice statuses of the blueprint's status model. */
entity InvoiceStatuses : CodeList {
  key code        : String(20);
      criticality : Integer; // 0 neutral, 1 negative (red), 2 critical (orange), 3 positive (green)
}

/** Per-item result of the latest match run. */
entity ItemMatchStatuses : CodeList {
  key code        : String(15);
      criticality : Integer;
}

/** Exception types; also the failure codes in MatchResults.result (plus PASS). */
entity ExceptionTypes : CodeList {
  key code        : String(20);
      criticality : Integer;
}

/** How an exception was decided (value help of the resolve action). */
entity ExceptionResolutions : CodeList {
  key code : String(10);
}

/** Exception statuses with UI criticality. */
entity ExceptionStatuses : CodeList {
  key code        : String(10);
      criticality : Integer;
}

/** Why an invoice waits for AP Manager approval. */
entity ApprovalReasons : CodeList {
  key code : String(30);
}

/** Variance types of tolerance rules (value help). */
entity VarianceTypes : CodeList {
  key code : String(10);
}
