import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectObservedCard } from "../src/pipeline/dry-run.js";
const card = {
  page: 1,
  match_id: "123",
  date_text: "09/13/26",
  time_text: "2 PM",
  division: "Example",
  home_team: "Home",
  away_team: "Away",
  location: "Park",
  rendered_path: "page.png",
  rendered_sha256: "a".repeat(64),
  lines: [
    {
      round: 1,
      position_text: "#1 Singles",
      home_names: ["H"],
      away_names: ["A"],
      home_games: 5,
      away_games: 2,
    },
  ],
  printed_home_total: 5,
  printed_away_total: 2,
};
test("dry run preserves partial scores and cannot promote arithmetic success into approval", () => {
  const r = inspectObservedCard(card);
  assert.equal(r.totals.match, true);
  assert.equal(r.state, "NEEDS_REVIEW");
  assert.equal(r.approved_json, null);
  assert.equal(r.interpretation_pass_2, null);
  assert.equal(r.submission, "DISABLED_DRY_RUN");
  assert.ok(r.issues.some((i) => i.code === "SCORING_FORMAT_UNCONFIRMED"));
});
test("dry run detects incorrect printed totals and duplicate positions", () => {
  const r = inspectObservedCard({
    ...card,
    printed_home_total: 9,
    lines: [...card.lines, ...card.lines],
  });
  assert.ok(r.issues.some((i) => i.code === "TOTAL_MISMATCH"));
  assert.ok(r.issues.some((i) => i.code === "DUPLICATE_POSITION"));
});
test("dry run rejects incorrect doubles lineup counts", () => {
  const r = inspectObservedCard({
    ...card,
    lines: [{ ...card.lines[0]!, position_text: "#1 Doubles" }],
  });
  assert.ok(r.issues.some((i) => i.code === "PLAYER_COUNT"));
});
