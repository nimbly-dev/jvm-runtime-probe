const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRoutingContext,
  resolveSelectedMode,
} = require("@tools-core/recipe_intent_routing.util");

test("regression_http_only keeps regression mode and disables probe tools", () => {
  const decision = resolveSelectedMode(buildRoutingContext({ intentMode: "regression_http_only" }));
  assert.equal(decision.selectedMode, "regression_http_only");
  assert.equal(decision.probeIntentRequested, false);
  assert.equal(decision.lineTargetProvided, false);
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

test("probe-only intent without line target stays in probe mode for fail-closed handling", () => {
  const decision = resolveSelectedMode(buildRoutingContext({ intentMode: "single_line_probe" }));
  assert.equal(decision.selectedMode, "single_line_probe");
  assert.equal(decision.probeIntentRequested, true);
  assert.equal(decision.lineTargetProvided, false);
});

test("combined intent without line target stays in combined mode for fail-closed handling", () => {
  const decision = resolveSelectedMode(
    buildRoutingContext({ intentMode: "regression_plus_line_probe" }),
  );
  assert.equal(decision.selectedMode, "regression_plus_line_probe");
  assert.equal(decision.probeIntentRequested, true);
  assert.equal(decision.lineTargetProvided, false);
});

test("routing decision parity is unchanged when diagnostics fields are present", () => {
  const baselineContext = buildRoutingContext({
    intentMode: "regression_plus_line_probe",
    lineHint: 42,
  });
  const baselineDecision = resolveSelectedMode(baselineContext);

  const diagnosticAugmentedContext = {
    ...baselineContext,
    reasonCode: "runtime_line_unresolved",
    nextActionCode: "select_resolvable_line",
    reasonMeta: { failedStep: "line_validation", unknownKey: "ignored" },
  };
  const augmentedDecision = resolveSelectedMode(diagnosticAugmentedContext as any);

  assert.deepEqual(augmentedDecision, baselineDecision);
});
