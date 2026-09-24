import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScoreSheet } from "../src/tennis/score-validator.js";
import { completedGames, partialGames } from "../src/tennis/scoring-rules.js";
import { assertTransition } from "../src/domain/pipeline-state.js";
import { loadConfig } from "../src/config.js";
import { fingerprint } from "../src/domain/fingerprint.js";
import {
  ApprovedMatchSchema,
  InterpretedScoreSheetSchema,
  MatchPayloadSchema,
} from "../src/domain/schemas.js";
import {
  context,
  rules,
  sheet,
  shortSetContext,
  shortSetRules,
  shortSetSheet,
} from "./fixtures.js";
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
  "retirement of a decided line": (s: typeof sheet) => {
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
  assert.equal(partialGames(3, 1, short), true);
  assert.equal(partialGames(3, 3, short), true);
  assert.equal(partialGames(4, 2, short), false);
  assert.equal(partialGames(4, 4, short), false);
  assert.equal(partialGames(5, 3, short), false);
  assert.equal(partialGames(6, 6, rules[0]!), true);
  assert.equal(partialGames(6, 5, rules[0]!), true);
  assert.equal(partialGames(7, 5, rules[0]!), false);
  assert.equal(partialGames(7, 6, { ...rules[0]!, tiebreak_at: null }), true);
  assert.equal(partialGames(9, 6, { ...rules[0]!, tiebreak_at: null }), false);
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
test("payload schema ties the winner to the result status", () => {
  const line = {
    position: "1S",
    home_player_ids: ["h1"],
    away_player_ids: ["a1"],
    sets: [{ set_number: 1, kind: "games" as const, home: 3, away: 1 }],
    winner: "home" as const,
    status: "timed" as const,
  };
  const payload = { match_id: "1", home_team_id: "h", away_team_id: "a", lines: [line] };
  assert.doesNotThrow(() => MatchPayloadSchema.parse(payload));
  assert.throws(() => MatchPayloadSchema.parse({ ...payload, lines: [{ ...line, winner: null }] }));
  assert.throws(() =>
    MatchPayloadSchema.parse({ ...payload, lines: [{ ...line, status: "double_default" }] }),
  );
  assert.throws(() =>
    MatchPayloadSchema.parse({ ...payload, lines: [{ ...line, status: "completed", sets: [] }] }),
  );
  assert.doesNotThrow(() =>
    MatchPayloadSchema.parse({
      ...payload,
      lines: [{ ...line, status: "double_default", sets: [], winner: null }],
    }),
  );
  assert.doesNotThrow(() =>
    MatchPayloadSchema.parse({ ...payload, lines: [{ ...line, status: "default", sets: [] }] }),
  );
  assert.throws(() => MatchPayloadSchema.parse({ ...payload, lines: [{ ...line, status: "walkover" }] }));
});

const codes = (r: ReturnType<typeof validateScoreSheet>) =>
  r.valid ? [] : r.issues.map((i) => i.code);
const short = (
  home: number,
  away: number,
  status: Parameters<typeof shortSetSheet>[2],
  winner: "home" | "away" | null = null,
) => validateScoreSheet(shortSetSheet(home, away, status, winner), shortSetContext, shortSetRules);

test("timed: winner by games, status carried into the payload", () => {
  const r = short(3, 1, "timed");
  assert.equal(r.valid, true);
  if (r.valid) {
    assert.equal(r.value.payload.lines[0]?.status, "timed");
    assert.equal(r.value.payload.lines[0]?.winner, "home");
    assert.deepEqual(r.value.payload.lines[0]?.sets, [
      { set_number: 1, kind: "games", home: 3, away: 1 },
    ]);
  }
});
test("timed with equal games needs a named winner", () => {
  assert.ok(codes(short(2, 2, "timed")).includes("TIMED_TIE"));
  const named = short(2, 2, "timed", "away");
  assert.equal(named.valid, true);
  if (named.valid) assert.equal(named.value.payload.lines[0]?.winner, "away");
});
test("a finished score is not timed; an unfinished score is not completed", () => {
  assert.ok(codes(short(4, 1, "timed")).includes("STATUS_MISMATCH"));
  assert.ok(codes(short(3, 1, "completed")).includes("INCOMPLETE_MATCH"));
  assert.equal(short(4, 1, "completed").valid, true);
  assert.equal(short(4, 3, "completed").valid, true);
});
test("unreachable scores are rejected under every status", () => {
  for (const status of ["completed", "timed", "retired", "default"] as const)
    assert.ok(codes(short(5, 3, status, "home")).includes("INVALID_SET"), status);
  assert.ok(codes(short(4, 4, "timed", "home")).includes("INVALID_SET"));
});
test("retired and default keep the scores as played and need a named winner", () => {
  assert.ok(codes(short(2, 1, "retired")).includes("WINNER_REQUIRED"));
  const r = short(2, 1, "retired", "away");
  assert.equal(r.valid, true);
  if (r.valid) {
    assert.equal(r.value.payload.lines[0]?.winner, "away");
    assert.equal(r.value.payload.lines[0]?.status, "retired");
    assert.deepEqual(r.value.payload.lines[0]?.sets, [
      { set_number: 1, kind: "games", home: 2, away: 1 },
    ]);
  }
  assert.ok(codes(short(4, 1, "retired", "home")).includes("STATUS_MISMATCH"));
  const d = short(1, 0, "default", "home");
  assert.equal(d.valid, true);
  if (d.valid) assert.equal(d.value.payload.lines[0]?.status, "default");
});
test("default without scores; double default without scores or winner", () => {
  const noScores = shortSetSheet(0, 0, "default", "home");
  noScores.lines[0]!.sets = [];
  const d = validateScoreSheet(noScores, shortSetContext, shortSetRules);
  assert.equal(d.valid, true);
  if (d.valid) assert.deepEqual(d.value.payload.lines[0]?.sets, []);
  const dd = shortSetSheet(0, 0, "double_default");
  dd.lines[0]!.sets = [];
  const r = validateScoreSheet(dd, shortSetContext, shortSetRules);
  assert.equal(r.valid, true);
  if (r.valid) assert.equal(r.value.payload.lines[0]?.winner, null);
  const ddWinner = structuredClone(dd);
  ddWinner.lines[0]!.observed_winner = "home";
  assert.ok(
    codes(validateScoreSheet(ddWinner, shortSetContext, shortSetRules)).includes("WINNER_NOT_ALLOWED"),
  );
  assert.ok(codes(short(1, 0, "double_default")).includes("SCORES_NOT_ALLOWED"));
});
test("walkover is not a form result", () => {
  assert.ok(codes(short(4, 0, "walkover", "home")).includes("UNSUPPORTED_STATUS"));
});
test("a decided best-of-three cannot be recorded as retired", () => {
  const s = structuredClone(sheet);
  s.lines[0]!.status = "retired";
  assert.ok(codes(validateScoreSheet(s, context, rules)).includes("STATUS_MISMATCH"));
});
test("timed after one completed set of a best-of-three: winner by total games", () => {
  const s = structuredClone(sheet);
  s.lines[0]!.status = "timed";
  s.lines[0]!.observed_winner = null;
  s.lines[0]!.sets = [
    { set_number: 1, kind: "games", home: 6, away: 4, needs_review: false, ambiguity: null },
    { set_number: 2, kind: "games", home: 2, away: 5, needs_review: false, ambiguity: null },
  ];
  const r = validateScoreSheet(s, context, rules);
  assert.equal(r.valid, true);
  if (r.valid) assert.equal(r.value.payload.lines[0]?.winner, "away");
});
