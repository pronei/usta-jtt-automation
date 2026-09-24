import { z } from "zod";
import { MatchDiscoverySchema } from "../domain/schemas.js";

const name = z.string().trim().min(1);
const count = z.number().int().nonnegative();
export const ObservedCardSchema = z.strictObject({
  page: z.number().int().positive(),
  match_id: z.string().regex(/^\d+$/),
  date_text: name,
  time_text: name,
  division: name,
  home_team: name,
  away_team: name,
  location: name,
  rendered_path: name,
  rendered_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z
    .array(
      z.strictObject({
        round: z.number().int().positive(),
        position_text: z.string().regex(/^#\d+ (Singles|Doubles)$/),
        home_names: z.array(name).min(1).max(2),
        away_names: z.array(name).min(1).max(2),
        home_games: count,
        away_games: count,
      }),
    )
    .min(1),
  printed_home_total: count,
  printed_away_total: count,
});
export const ObservationsSchema = z.strictObject({
  source_path: name,
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_method: name,
  cards: z.array(ObservedCardSchema).min(1),
});
export function inspectObservedCard(raw: unknown) {
  const card = ObservedCardSchema.parse(raw);
  const home = card.lines.reduce((sum, line) => sum + line.home_games, 0);
  const away = card.lines.reduce((sum, line) => sum + line.away_games, 0);
  const issues = [
    {
      code: "OFFICIAL_CONTEXT_MISSING",
      message:
        "No TennisLink match, roster, expected lines or existing-result status captured.",
    },
    {
      code: "PLAYER_IDS_UNRESOLVED",
      message:
        "Observed names are not official roster identities. Abbreviations and aliases have not been merged.",
    },
    {
      code: "SCORING_FORMAT_UNCONFIRMED",
      message:
        "Game totals are preserved as printed; no set structure, completion status or league rules are inferred.",
    },
  ];
  if (home !== card.printed_home_total || away !== card.printed_away_total)
    issues.push({
      code: "TOTAL_MISMATCH",
      message: "Computed line sums do not match the printed team totals.",
    });
  if (
    new Set(card.lines.map((l) => l.position_text)).size !== card.lines.length
  )
    issues.push({
      code: "DUPLICATE_POSITION",
      message: "The document contains duplicate positions.",
    });
  for (const line of card.lines) {
    const expected = line.position_text.endsWith("Doubles") ? 2 : 1;
    if (
      line.home_names.length !== expected ||
      line.away_names.length !== expected
    )
      issues.push({
        code: "PLAYER_COUNT",
        message: `Unexpected player count at ${line.position_text}.`,
      });
  }
  return {
    discovery: MatchDiscoverySchema.parse({
      match_id: card.match_id,
      home_team_text: card.home_team,
      away_team_text: card.away_team,
      date_text: card.date_text,
      needs_review: false,
      ambiguities: [],
    }),
    state: "NEEDS_REVIEW" as const,
    totals: {
      computed_home: home,
      computed_away: away,
      printed_home: card.printed_home_total,
      printed_away: card.printed_away_total,
      match:
        home === card.printed_home_total && away === card.printed_away_total,
    },
    issues,
    official_context: null,
    interpretation_pass_2: null,
    tennis_validation: "NOT_RUN_MISSING_OFFICIAL_CONTEXT_AND_RULES",
    approved_json: null,
    population: "NOT_RUN",
    submission: "DISABLED_DRY_RUN",
  };
}
