import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScoreSheet } from "../src/tennis/score-validator.js";
import { completedGames } from "../src/tennis/scoring-rules.js";
import { assertTransition } from "../src/domain/pipeline-state.js";
import { loadConfig } from "../src/config.js";
import { fingerprint } from "../src/domain/fingerprint.js";
import {
  ApprovedMatchSchema,
  InterpretedScoreSheetSchema,
} from "../src/domain/schemas.js";
import { context, rules, sheet } from "./fixtures.js";
test("strict AI data cannot parse as an approval", () => {
  assert.throws(() => ApprovedMatchSchema.parse(sheet));
  assert.throws(() =>
    InterpretedScoreSheetSchema.parse({ ...sheet, approved_by: "AI" }),
  );
});
test("valid scores produce deterministic winner and source hashes", () => {
  const r = validateScoreSheet(sheet, context, rules);
  assert.equal(r.valid, true);
  if (r.valid) {
    assert.equal(r.value.payload.lines[0]?.winner, "home");
    assert.equal(r.value.context_hash, fingerprint(context));
  }
});
for (const [name, mutate] of Object.entries({
  "missing score": (s: typeof sheet) => {
    s.lines[0]!.sets[0]!.home = null;
  },
  "incomplete set": (s: typeof sheet) => {
    s.lines[0]!.sets[0]!.home = 5;
  },
  "wrong side player": (s: typeof sheet) => {
    s.lines[0]!.home_players[0]!.roster_player_id = "a1";
  },
  "probable identity": (s: typeof sheet) => {
    s.lines[0]!.home_players[0]!.resolution = "probable";
  },
  "winner conflict": (s: typeof sheet) => {
    s.lines[0]!.observed_winner = "away";
  },
  retirement: (s: typeof sheet) => {
    s.lines[0]!.status = "retired";
  },
  "missing line": (s: typeof sheet) => {
    s.lines = [];
  },
  "duplicate line": (s: typeof sheet) => {
    s.lines.push(structuredClone(s.lines[0]!));
  },
  "extra set": (s: typeof sheet) => {
    s.lines[0]!.sets.push({ ...s.lines[0]!.sets[0]!, set_number: 3 });
  },
  "unresolved ambiguity": (s: typeof sheet) => {
    s.ambiguities = ["Illegible"];
  },
  "wrong match": (s: typeof sheet) => {
    s.match_id = "9";
  },
}))
  test(`rejects ${name}`, () => {
    const s = structuredClone(sheet);
    mutate(s);
    assert.equal(validateScoreSheet(s, context, rules).valid, false);
  });
test("supports deciding match tiebreak and extended tiebreak score", () => {
  const s = structuredClone(sheet);
  s.lines[0]!.sets[1]!.home = 3;
  s.lines[0]!.sets[1]!.away = 6;
  s.lines[0]!.sets.push({
    set_number: 3,
    kind: "match_tiebreak",
    home: 12,
    away: 10,
    needs_review: false,
    ambiguity: null,
  });
  assert.equal(validateScoreSheet(s, context, rules).valid, true);
  s.lines[0]!.sets[2]!.home = 13;
  assert.equal(validateScoreSheet(s, context, rules).valid, false);
});
test("multiple scoring formats are explicit, including short sets", () => {
  const short = { ...rules[0]!, games_to_win: 4, tiebreak_at: 3 };
  assert.equal(completedGames(4, 3, short), true);
  assert.equal(completedGames(5, 3, short), false);
  assert.equal(completedGames(7, 6, rules[0]!), true);
  assert.equal(completedGames(8, 6, rules[0]!), false);
  assert.equal(completedGames(8, 6, { ...rules[0]!, tiebreak_at: null }), true);
  const c = structuredClone(context);
  c.expected_lines[0]!.scoring_rule_id = "missing";
  assert.equal(validateScoreSheet(sheet, c, rules).valid, false);
});
test("cannot skip validation or retry uncertain submit", () => {
  assert.throws(() => assertTransition("NEEDS_REVIEW", "APPROVED"));
  assert.throws(() => assertTransition("SUBMISSION_UNKNOWN", "SUBMITTING"));
  assert.throws(() => assertTransition("SCORE_SHEET_INTERPRETED", "SUBMITTED"));
});
test("feature flag is explicit and defaults off", () => {
  assert.equal(loadConfig({}).finalSubmissionEnabled, false);
  assert.equal(
    loadConfig({ ENABLE_FINAL_SUBMISSION: "true" }).finalSubmissionEnabled,
    true,
  );
  assert.throws(() => loadConfig({ ENABLE_FINAL_SUBMISSION: "1" }));
  assert.throws(() =>
    loadConfig({ TENNISLINK_ENTRY_URL: "https://evil.example" }),
  );
});
test("fingerprint ignores object property order", () =>
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 })));
