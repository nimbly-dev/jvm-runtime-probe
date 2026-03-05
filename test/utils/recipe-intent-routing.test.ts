const assert = require("node:assert/strict");
const test = require("node:test");

const { LINE_TARGET_MISSING_NOTE } = require("../../src/utils/recipe_constants.util");
const {
  buildRoutingContext,
  resolveSelectedMode,
} = require("../../src/utils/recipe_intent_routing.util");

test("regression_api_only keeps regression mode and disables probe tools", () => {
  const decision = resolveSelectedMode(buildRoutingContext({ intentMode: "regression_api_only" }));
  assert.equal(decision.selectedMode, "regression_api_only");
  assert.equal(decision.probeIntentRequested, false);
  assert.equal(decision.lineTargetProvided, false);
  assert.equal(decision.downgradedFrom, undefined);
});

test("single_line_probe with explicit line keeps probe mode", () => {
  const decision = resolveSelectedMode(
    buildRoutingContext({ intentMode: "single_line_probe", lineHint: 77 }),
  );
  assert.equal(decision.selectedMode, "single_line_probe");
  assert.equal(decision.probeIntentRequested, true);
  assert.equal(decision.lineTargetProvided, true);
});

test("combined mode with explicit line keeps combined route", () => {
  const decision = resolveSelectedMode(
    buildRoutingContext({ intentMode: "regression_plus_line_probe", lineHint: 12 }),
  );
  assert.equal(decision.selectedMode, "regression_plus_line_probe");
  assert.equal(decision.probeIntentRequested, true);
  assert.equal(decision.lineTargetProvided, true);
});

test("probe-only intent without line target downgrades to regression_api_only", () => {
  const decision = resolveSelectedMode(buildRoutingContext({ intentMode: "single_line_probe" }));
  assert.equal(decision.selectedMode, "regression_api_only");
  assert.equal(decision.downgradedFrom, "single_line_probe");
  assert.equal(decision.routingNote, LINE_TARGET_MISSING_NOTE);
});

test("combined intent without line target downgrades to regression_api_only", () => {
  const decision = resolveSelectedMode(
    buildRoutingContext({ intentMode: "regression_plus_line_probe" }),
  );
  assert.equal(decision.selectedMode, "regression_api_only");
  assert.equal(decision.downgradedFrom, "regression_plus_line_probe");
  assert.equal(decision.routingNote, LINE_TARGET_MISSING_NOTE);
});
