import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage/database.js";
import { validateScoreSheet } from "../src/tennis/score-validator.js";
import { jobMeasurements, median, renderReport, seasonReport } from "../src/measure/report.js";
import { context, rules, sheet } from "./fixtures.js";

test("the store stamps events with the injected clock and keeps baselines", () => {
  let t = Date.parse("2026-09-13T20:00:00.000Z");
  const store = new Store(":memory:", () => new Date(t));
  try {
    const id = store.createJob({ original_sha256: "a", original_path: "a.pdf" }, "coach");
    t += 60_000;
    store.checkpoint(id, 0, "IMAGE_PREPARED", "coach", {});
    const at = store.history(id).map((r) => String(r.at));
    assert.deepEqual(at, ["2026-09-13T20:00:00.000Z", "2026-09-13T20:01:00.000Z"]);
    store.recordBaseline({ match_id: "123456", minutes: 22.5, recorded_by: "coach", note: "laptop, paper card" });
    assert.deepEqual(store.listBaselines(), [
      { match_id: "123456", minutes: 22.5, recorded_by: "coach", note: "laptop, paper card", at: "2026-09-13T20:01:00.000Z" },
    ]);
    assert.throws(() => store.recordBaseline({ match_id: "x", minutes: 5, recorded_by: "coach", note: "" }));
    assert.throws(() => store.recordBaseline({ match_id: "1", minutes: 0, recorded_by: "coach", note: "" }));
  } finally {
    store.close();
  }
});

const errors = { roster_mismatch: 2, status_not_completed: 3, winner_first_reorder: 1, totals_mismatch: 0, score_edited: 0, total: 6 };

/** Upload at t0, approve 5 minutes later, fill plan served after 1 more, read back 2 minutes after that, submit 1 minute later. */
function runThrough(store: Store, tick: (ms: number) => void, submit: boolean) {
  const id = store.createJob({ original_sha256: "a", original_path: "a.pdf" }, "coach");
  const result = validateScoreSheet(sheet, context, rules);
  if (!result.valid) throw new Error("fixture");
  tick(5 * 60_000);
  for (const s of ["IMAGE_PREPARED", "MATCH_DISCOVERED", "TENNISLINK_MATCH_FOUND", "OFFICIAL_CONTEXT_CAPTURED", "SCORE_SHEET_INTERPRETED", "VALIDATING", "VALIDATED"] as const)
    store.checkpoint(
      id,
      store.getJob(id).revision,
      s,
      "coach",
      s === "VALIDATED" ? result.value : s === "MATCH_DISCOVERED" ? { observed_card: { match_id: "123456" } } : {},
    );
  const approved = store.approve(id, store.getJob(id).revision, result.value, "coach");
  store.annotate(id, "coach", "ERRORS_CAUGHT", errors);
  if (!submit) return id;
  tick(60_000);
  store.annotate(id, "bookmarklet:coach", "FILL_PLAN_SERVED", {});
  tick(2 * 60_000);
  store.checkpoint(id, store.getJob(id).revision, "POPULATING_TENNISLINK", "bookmarklet:coach", {});
  store.checkpoint(id, store.getJob(id).revision, "POPULATION_VERIFIED", "bookmarklet:coach", {});
  store.reserveSubmission(id, store.getJob(id).revision, approved);
  tick(60_000);
  store.completeSubmission(id, "https://tennislink.usta.com/x\nGames 7 3", "bookmarklet:coach");
  return id;
}

test("job measurements come from event timestamps and the errors annotation", () => {
  let t = Date.parse("2026-09-13T20:00:00.000Z");
  const store = new Store(":memory:", () => new Date(t));
  try {
    const id = runThrough(store, (ms) => (t += ms), true);
    const m = jobMeasurements(store, id);
    assert.equal(m.state, "SUBMITTED");
    assert.equal(m.uploaded_at, "2026-09-13T20:00:00.000Z");
    assert.equal(m.minutes_to_approval, 5);
    assert.equal(m.minutes_fill, 2);
    assert.equal(m.submitted_at, "2026-09-13T20:09:00.000Z");
    assert.deepEqual(m.errors, errors);
  } finally {
    store.close();
  }
});

test("season report: counts, sums, medians, baselines, markdown", () => {
  let t = Date.parse("2026-09-13T20:00:00.000Z");
  const store = new Store(":memory:", () => new Date(t));
  try {
    runThrough(store, (ms) => (t += ms), true);
    runThrough(store, (ms) => (t += ms), false);
    store.recordBaseline({ match_id: "2743892", minutes: 18, recorded_by: "coach", note: "" });
    store.recordBaseline({ match_id: "2743982", minutes: 25, recorded_by: "coach", note: "" });
    const r = seasonReport(store);
    assert.equal(r.jobs.length, 2);
    assert.equal(r.matches_uploaded, 2);
    assert.equal(r.matches_approved, 2);
    assert.equal(r.matches_submitted, 1);
    assert.equal(r.errors.total, 12);
    assert.equal(r.median_minutes_to_approval, 5);
    assert.equal(r.median_minutes_fill, 2);
    assert.equal(r.median_baseline_minutes, 21.5);
    assert.equal(median([]), null);
    assert.equal(median([3, 1, 2]), 2);
    const md = renderReport(r, new Date(t));
    assert.match(md, /Matches uploaded: 2 · approved: 2 · submitted: 1/);
    assert.match(md, /\| 123456 \| SUBMITTED \| 5 \| 2 \| 6 \|/);
    assert.match(md, /Median manual entry: 21\.5 min \(2 recorded\)/);
  } finally {
    store.close();
  }
});
