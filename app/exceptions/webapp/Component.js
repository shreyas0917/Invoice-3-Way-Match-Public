sap.ui.define(["sap/fe/core/AppComponent"], function (AppComponent) {
  "use strict";
  // Fiori elements app: all screens are generated from manifest.json + CDS annotations.
  return AppComponent.extend("ap.exceptions.Component", {
    metadata: { manifest: "json" }
  });
});
