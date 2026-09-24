import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import {
  ObservationsSchema,
  inspectObservedCard,
} from "../pipeline/dry-run.js";
import { Store } from "../storage/database.js";

const input = process.argv[2],
  output = process.argv[3];
if (!input || !output)
  throw new Error("Usage: dry-run observations.json NEW_OUTPUT_DIRECTORY");
const observations = ObservationsSchema.parse(
  JSON.parse(await readFile(input, "utf8")),
);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
if (
  digest(await readFile(observations.source_path)) !==
  observations.source_sha256
)
  throw new Error("Source PDF hash mismatch");
for (const card of observations.cards)
  if (digest(await readFile(card.rendered_path)) !== card.rendered_sha256)
    throw new Error("Rendered page hash mismatch");
const destination = resolve(output);
// A unique output directory prevents accidental overwrites of a previous run's evidence.
await mkdir(destination, { recursive: false, mode: 0o700 });
const store = new Store(join(destination, "audit.sqlite"));
const results = [];
try {
  for (const card of observations.cards) {
    const result = inspectObservedCard(card);
    const id = store.createJob(
      {
        original_sha256: observations.source_sha256,
        original_path: observations.source_path,
      },
      "dry-run",
    );
    store.checkpoint(id, 0, "IMAGE_PREPARED", "dry-run", {
      page: card.page,
      path: card.rendered_path,
      sha256: card.rendered_sha256,
      operations: ["PDF render at 1.5x; no rotation/cropping/contrast edits"],
    });
    store.checkpoint(id, 1, "MATCH_DISCOVERED", "dry-run", {
      method: observations.extraction_method,
      discovery: result.discovery,
    });
    store.checkpoint(id, 2, "NEEDS_REVIEW", "dry-run", {
      observed_card: card,
      result,
    });
    results.push({
      job_id: id,
      page: card.page,
      match_id: card.match_id,
      home_team: card.home_team,
      away_team: card.away_team,
      ...result,
    });
  }
  await writeFile(
    join(destination, "results.json"),
    JSON.stringify(
      {
        mode: "LOCAL_DRY_RUN",
        source_sha256: observations.source_sha256,
        extraction_method: observations.extraction_method,
        official_site_accessed: false,
        model_api_called: false,
        results,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  const report = [
    "# Scorecard dry run",
    "",
    "Local PDF extraction and preflight checks only. No TennisLink access, model API call, approval, browser population or submission occurred.",
    "",
    "The PDF is a digital transcription, not the original photographed handwriting. Name and score accuracy against the original paper has not been verified.",
    "",
    "| Page | Match | Home team | Away team | Computed games | Printed totals match | State |",
    "|---|---|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.page} | ${r.match_id} | ${r.home_team} | ${r.away_team} | ${r.totals.computed_home}–${r.totals.computed_away} | ${r.totals.match ? "Yes" : "No"} | ${r.state} |`,
    ),
    "",
    "## Required before validation",
    "",
    "- Capture official TennisLink match, both rosters, expected lines and existing-result status.",
    "- Resolve names to official player IDs, preserving abbreviations and aliases until verified.",
    "- Confirm each division's scoring format, including treatment of partial/timed scores and player reuse across lines.",
    "- Run roster-aware interpretation and deterministic validation, then obtain human approval.",
    "",
    "Raw game counts have not been converted into completed sets. The current validator does not support timed/partial results; these need an explicit implementation if required by the official format.",
    "",
  ];
  for (const card of observations.cards) {
    report.push(
      `## Match ${card.match_id}`,
      "",
      `Date: ${card.date_text}; ${card.time_text}; ${card.division}; ${card.location}.`,
      "",
      "| Round | Position | Home players (as printed) | Away players (as printed) | Games |",
      "|---|---|---|---|---|",
      ...card.lines.map(
        (l) =>
          `| ${l.round} | ${l.position_text} | ${l.home_names.join(" / ")} | ${l.away_names.join(" / ")} | ${l.home_games}–${l.away_games} |`,
      ),
      "",
    );
  }
  await writeFile(join(destination, "report.md"), report.join("\n"), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        report: join(destination, "report.md"),
        matches: results.map((r) => ({
          match_id: r.match_id,
          totals: r.totals,
          state: r.state,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
