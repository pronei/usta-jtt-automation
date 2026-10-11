import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { MatchIdSchema } from "../domain/schemas.js";
import { ObservedCardSchema, inspectObservedCard } from "../pipeline/dry-run.js";
import type { Store } from "../storage/database.js";
import type { IngestedCard } from "./upload.js";

// The document the Momentum platform exports from /coach/scorecards (its src/lib/server/domain/scorecards/export.ts):
// the observed card without the PDF render fields, plus the coach's result and winner per line.
const games = z.number().int().nonnegative().nullable();
export const ExportDocumentSchema = z.strictObject({
  source: z.literal("momentum-tennis-platform"),
  scorecard_id: z.string().min(1),
  exported_at: z.iso.datetime(),
  format: z.enum(["two_court", "three_court"]),
  set_games: z.union([z.literal(4), z.literal(6)]),
  card: z.strictObject({
    match_id: MatchIdSchema.nullable(),
    date_text: z.string().min(1),
    time_text: z.string(),
    division: z.string().min(1),
    home_team: z.string().min(1),
    away_team: z.string().min(1),
    location: z.string().min(1),
    lines: z
      .array(
        z.strictObject({
          round: z.number().int().positive(),
          position_text: z.string().regex(/^#\d+ (Singles|Doubles)$/),
          home_names: z.array(z.string().min(1)).max(2),
          away_names: z.array(z.string().min(1)).max(2),
          home_games: games,
          away_games: games,
          result: z.enum(["completed", "timed", "retired", "default", "double_default"]).nullable(),
          winner: z.enum(["home", "away"]).nullable(),
        }),
      )
      .length(8),
    printed_home_total: z.number().int().nonnegative(),
    printed_away_total: z.number().int().nonnegative(),
  }),
});
export type ExportDocument = z.infer<typeof ExportDocumentSchema>;

/** One job from one exported scorecard. The card must carry its match id and a result on every line. */
export async function ingestExport(
  store: Store,
  uploadDir: string,
  bytes: Buffer,
  actor: string,
): Promise<IngestedCard[]> {
  const doc = ExportDocumentSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (doc.card.match_id === null)
    throw new Error("The scorecard has no match id; set it on the platform before exporting");
  const unfinished = doc.card.lines.filter((l) => l.result === null).map((l) => l.position_text);
  if (unfinished.length)
    throw new Error(`No result on ${unfinished.join(", ")}; finish the card on the platform first`);
  const dir = resolve(uploadDir, randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "scorecard.json");
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  const sha = createHash("sha256").update(bytes).digest("hex");
  const card = ObservedCardSchema.parse({
    page: 1,
    match_id: doc.card.match_id,
    date_text: doc.card.date_text,
    time_text: doc.card.time_text,
    division: doc.card.division,
    home_team: doc.card.home_team,
    away_team: doc.card.away_team,
    location: doc.card.location,
    rendered_path: `momentum-tennis-platform:scorecard:${doc.scorecard_id}`,
    rendered_sha256: sha,
    lines: doc.card.lines,
    printed_home_total: doc.card.printed_home_total,
    printed_away_total: doc.card.printed_away_total,
  });
  const preflight = inspectObservedCard(card);
  const id = store.createJob({ original_sha256: sha, original_path: path }, actor);
  store.checkpoint(id, 0, "IMAGE_PREPARED", actor, {
    page: 1,
    path: card.rendered_path,
    sha256: sha,
    operations: ["Momentum platform export; no image"],
  });
  store.checkpoint(id, 1, "MATCH_DISCOVERED", actor, {
    method: "momentum-tennis-platform export",
    discovery: preflight.discovery,
    observed_card: card,
    totals: preflight.totals,
    issues: preflight.issues,
    export: {
      scorecard_id: doc.scorecard_id,
      exported_at: doc.exported_at,
      format: doc.format,
      set_games: doc.set_games,
    },
  });
  return [
    {
      job_id: id,
      match_id: card.match_id,
      home_team: card.home_team,
      away_team: card.away_team,
      code: store.issueCode(id, actor),
    },
  ];
}
