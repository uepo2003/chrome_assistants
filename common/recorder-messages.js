// Recipe Recorder message constants (BtoB pivot — Phase 3, v0.4).
//
// Loaded as a content script BEFORE content/recorder.js (and attached to
// globalThis so recorder.js can read it without module syntax). The service
// worker mirrors these literals in its own MSG table — keep them in sync.
//
// Plain IIFE, no module syntax (it ships as an MV3 content script).

(function () {
  "use strict";

  var RECORDER_MSG = Object.freeze({
    // sidepanel/bg -> content : begin capturing user interactions.
    //   payload: { recipeDraftId }
    START: "AT_RECORDER_START",
    // sidepanel/bg -> content : stop capturing, detach listeners.
    STOP: "AT_RECORDER_STOP",
    // content -> bg : one captured interaction.
    //   payload: { recipeDraftId, event }
    EVENT: "AT_RECORDER_EVENT",
    // content/sidepanel -> bg : upsert the draft into at_user_recipes.
    SAVE: "AT_RECORDER_SAVE",
    // sidepanel -> bg : build & return the Recipe JSON for the draft.
    EXPORT: "AT_RECORDER_EXPORT",
    // bg -> sidepanel : a sensitive field was skipped (one-line notice).
    SKIPPED: "AT_RECORDER_SKIPPED",
  });

  globalThis.__AT_RECORDER_MSG__ = RECORDER_MSG;
})();
