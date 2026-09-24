import { test } from "node:test";
import assert from "node:assert/strict";
import { contextFromForm } from "../src/web/context.js";
import {
  draftFromCard,
  errorsCaught,
  matchName,
  orientCard,
  reviewFromForm,
  sheetFromReview,
} from "../src/web/reconcile.js";
import { validateScoreSheet } from "../src/tennis/score-validator.js";
import { shortSetRules } from "./fixtures.js";
import { card, capturedForm, formatRules } from "./web-fixtures.js";

const { context } = contextFromForm(capturedForm, formatRules);
const reviewParams = new URLSearchParams({
  "l0.home.0": "h1",
  "l0.away.0": "a1",
  "l0.home_games": "3",
  "l0.away_games": "1",
  "l0.status": "timed",
  "l0.winner": "",
  "l1.home.0": "h2",
  "l1.home.1": "h4",
  "l1.away.0": "a2",
  "l1.away.1": "a3",
  "l1.home_games": "4",
  "l1.away_games": "2",
  "l1.status": "completed",
  "l1.winner": "",
});

test("names resolve exact, probable, ambiguous or unresolved against the roster", () => {
  const roster = context.away_team.roster.concat(context.home_team.roster);
  assert.equal(matchName("Away Player", roster).resolution, "exact");
  assert.equal(matchName("Away Player", roster).chosen, "a1");
  assert.equal(matchName("ana", roster).resolution, "probable");
  assert.equal(matchName("ana", roster).chosen, "h3");
  const sam = matchName("Sam", roster);
  assert.equal(sam.resolution, "ambiguous");
  assert.equal(sam.chosen, null);
  assert.deepEqual(sam.candidates.map((c) => c.player_id), ["a3", "a4"]);
  assert.equal(matchName("Nobody Here", roster).resolution, "unresolved");
  assert.equal(matchName("", roster).resolution, "unresolved");
});

test("draft aligns card lines with expected lines and suggests a status from the games", () => {
  const draft = draftFromCard(card, context, shortSetRules);
  assert.deepEqual(
    draft.lines.map((l) => [l.position, l.found, l.suggested_status, l.suggested_winner]),
    [
      ["#1 Singles", true, "timed", "home"],
      ["#1 Doubles", true, "completed", "home"],
    ],
  );
  assert.deepEqual(draft.lines[1]!.home.map((s) => s.chosen), ["h2", "h4"]);
  assert.deepEqual(draft.lines[1]!.away.map((s) => s.chosen), ["a2", "a3"]);
  const missing = draftFromCard({ ...card, lines: [card.lines[0]!] }, context, shortSetRules);
  assert.equal(missing.lines[1]!.found, false);
  assert.equal(missing.lines[1]!.home.length, 2);
  assert.equal(missing.lines[1]!.home_games, null);
});

test("review form → sheet → valid result, with the errors caught tallied", () => {
  const draft = draftFromCard(card, context, shortSetRules);
  const review = reviewFromForm(reviewParams, draft);
  const sheet = sheetFromReview(review, draft, card, context);
  assert.equal(sheet.home_team, context.home_team.team_name);
  assert.equal(sheet.lines[0]!.status, "timed");
  const result = validateScoreSheet(sheet, context, shortSetRules);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(errorsCaught(draft, card, sheet, result.value.payload), {
    roster_mismatch: 0,
    status_not_completed: 1,
    winner_first_reorder: 0,
    totals_mismatch: 0,
    score_edited: 0,
    total: 1,
  });
});

test("an unresolved player or a blank score keeps the sheet out of validation", () => {
  const draft = draftFromCard(card, context, shortSetRules);
  const params = new URLSearchParams(reviewParams);
  params.set("l0.home.0", "");
  params.set("l0.home_games", "");
  const sheet = sheetFromReview(reviewFromForm(params, draft), draft, card, context);
  assert.equal(sheet.lines[0]!.home_players[0]!.resolution, "unresolved");
  assert.equal(sheet.lines[0]!.sets[0]!.needs_review, true);
  const r = validateScoreSheet(sheet, context, shortSetRules);
  assert.equal(r.valid, false);
  if (!r.valid) {
    const codes = r.issues.map((i) => i.code);
    assert.ok(codes.includes("PLAYER_IDENTITY"));
    assert.ok(codes.includes("UNRESOLVED_SCORE"));
  }
  assert.throws(() => reviewFromForm(new URLSearchParams({ "l0.home_games": "abc" }), draft));
});

test("edits and non-completed results count as errors caught", () => {
  const draft = draftFromCard(card, context, shortSetRules);
  const params = new URLSearchParams(reviewParams);
  params.set("l1.home.1", "h3");
  params.set("l1.away_games", "1");
  const sheet = sheetFromReview(reviewFromForm(params, draft), draft, card, context);
  const result = validateScoreSheet(sheet, context, shortSetRules);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const e = errorsCaught(draft, card, sheet, result.value.payload);
  assert.equal(e.roster_mismatch, 1);
  assert.equal(e.score_edited, 1);
  assert.equal(e.total, 3);
});

test("swapping orientation mirrors the card", () => {
  const s = orientCard(card, true);
  assert.equal(s.home_team, card.away_team);
  assert.equal(s.lines[0]!.home_games, 1);
  assert.equal(s.lines[0]!.away_games, 3);
  assert.deepEqual(s.lines[1]!.home_names, card.lines[1]!.away_names);
  assert.equal(s.printed_home_total, 3);
  assert.equal(orientCard(card, false), card);
});
