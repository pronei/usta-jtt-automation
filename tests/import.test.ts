import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObservedCardSchema, inspectObservedCard } from "../src/pipeline/dry-run.js";
import { Store } from "../src/storage/database.js";
import { contextFromForm } from "../src/web/context.js";
import { ingestExport } from "../src/web/import.js";
import { draftFromCard } from "../src/web/reconcile.js";
import { shortSetRules } from "./fixtures.js";
import { capturedForm, card, exportDocument, formatRules } from "./web-fixtures.js";

const bytes = (doc: unknown) => Buffer.from(JSON.stringify(doc));

test("a platform export becomes a job at MATCH_DISCOVERED with the coach's results kept as hints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jtt-import-"));
  const store = new Store(":memory:");
  try {
    const [c] = await ingestExport(store, dir, bytes(exportDocument), "coach");
    assert.equal(c!.match_id, "654321");
    assert.equal(store.getJob(c!.job_id).state, "MATCH_DISCOVERED");
    assert.equal(store.resolveCode(c!.code)?.job_id, c!.job_id);
    const d = store.latestArtifact(c!.job_id, "MATCH_DISCOVERED") as {
      method: string;
      observed_card: { lines: { result?: string | null; home_games: number | null }[]; rendered_path: string };
      totals: { computed_home: number; match: boolean };
      export: { scorecard_id: string; set_games: number };
    };
    assert.equal(d.method, "momentum-tennis-platform export");
    assert.equal(d.observed_card.lines[4]?.result, "retired");
    assert.equal(d.observed_card.lines[6]?.home_games, null);
    assert.equal(d.observed_card.rendered_path, `momentum-tennis-platform:scorecard:${exportDocument.scorecard_id}`);
    assert.equal(d.totals.computed_home, 16);
    assert.equal(d.totals.match, true);
    assert.equal(d.export.set_games, 4);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exports without a match id, with an unfinished line, or from elsewhere are refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jtt-import-"));
  const store = new Store(":memory:");
  try {
    const noId = structuredClone(exportDocument);
    noId.card.match_id = null;
    await assert.rejects(ingestExport(store, dir, bytes(noId), "coach"), /no match id/);
    const unfinished = structuredClone(exportDocument);
    unfinished.card.lines[2]!.result = null;
    await assert.rejects(ingestExport(store, dir, bytes(unfinished), "coach"), /No result on #2 Singles/);
    await assert.rejects(ingestExport(store, dir, bytes({ ...exportDocument, source: "elsewhere" }), "coach"));
    assert.equal(store.listJobs().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the draft takes the platform's result and winner as its suggestions and tolerates lines without games", () => {
  const { context } = contextFromForm(capturedForm, formatRules);
  const hinted = ObservedCardSchema.parse({
    ...card,
    lines: [
      { ...card.lines[0]!, result: "retired", winner: "away" },
      { ...card.lines[1]!, home_names: [], away_names: [], home_games: null, away_games: null, result: "double_default", winner: null },
    ],
  });
  const draft = draftFromCard(hinted, context, shortSetRules);
  assert.equal(draft.lines[0]!.suggested_status, "retired");
  assert.equal(draft.lines[0]!.suggested_winner, "away");
  assert.equal(draft.lines[1]!.suggested_status, "double_default");
  assert.equal(draft.lines[1]!.home_games, null);
  assert.equal(draft.lines[1]!.suggested_winner, null);
  assert.equal(draft.lines[1]!.home[0]!.resolution, "unresolved");
  const pdfStyle = draftFromCard(card, context, shortSetRules);
  assert.equal(pdfStyle.lines[0]!.suggested_status, "timed");
  assert.equal(inspectObservedCard(hinted).totals.computed_home, 3);
});
