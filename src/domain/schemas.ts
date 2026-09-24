import { z } from "zod";
const id = z.string().trim().min(1);
const score = z.number().int().nonnegative();
const side = z.enum(["home", "away"]);
export const MatchIdSchema = z.string().regex(/^\d+$/);
export const MatchDiscoverySchema = z.strictObject({
  match_id: MatchIdSchema.nullable(),
  home_team_text: id.nullable(),
  away_team_text: id.nullable(),
  date_text: id.nullable(),
  needs_review: z.boolean(),
  ambiguities: z.array(id),
});
export const RosterPlayerSchema = z.strictObject({
  player_id: id,
  display_name: id,
});
export const OfficialTeamSchema = z.strictObject({
  team_id: id,
  team_name: id,
  roster: z.array(RosterPlayerSchema).min(1),
});
export const ExpectedLineSchema = z
  .strictObject({
    position: id,
    type: z.enum(["singles", "doubles"]),
    players_per_side: z.union([z.literal(1), z.literal(2)]),
    scoring_rule_id: id,
  })
  .refine(
    (x) => x.players_per_side === (x.type === "singles" ? 1 : 2),
    "Line type/player count mismatch",
  );
export const OfficialMatchContextSchema = z
  .strictObject({
    match_id: MatchIdSchema,
    date: id.nullable(),
    home_team: OfficialTeamSchema,
    away_team: OfficialTeamSchema,
    expected_lines: z.array(ExpectedLineSchema).min(1),
    captured_at: z.iso.datetime(),
    source_url: z.url(),
    result_status: z.enum(["unreported", "reported", "unknown"]),
  })
  .superRefine((x, ctx) => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (
      x.home_team.team_id === x.away_team.team_id ||
      !unique(x.expected_lines.map((l) => l.position)) ||
      !unique(x.home_team.roster.map((p) => p.player_id)) ||
      !unique(x.away_team.roster.map((p) => p.player_id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate official identities or positions",
      });
  });
export const PlayerInterpretationSchema = z.strictObject({
  observed_text: id.nullable(),
  roster_player_id: id.nullable(),
  roster_name: id.nullable(),
  resolution: z.enum(["exact", "probable", "ambiguous", "unresolved"]),
  candidate_player_ids: z.array(id),
  needs_review: z.boolean(),
  ambiguity: id.nullable(),
});
export const SetInterpretationSchema = z.strictObject({
  set_number: z.number().int().positive(),
  kind: z.enum(["games", "match_tiebreak"]),
  home: score.nullable(),
  away: score.nullable(),
  needs_review: z.boolean(),
  ambiguity: id.nullable(),
});
export const LineInterpretationSchema = z.strictObject({
  position: id,
  home_players: z.array(PlayerInterpretationSchema),
  away_players: z.array(PlayerInterpretationSchema),
  sets: z.array(SetInterpretationSchema),
  observed_winner: side.nullable(),
  status: z.enum(["completed", "retired", "default", "walkover", "unknown"]),
  needs_review: z.boolean(),
  ambiguities: z.array(id),
});
export const InterpretedScoreSheetSchema = z.strictObject({
  match_id: MatchIdSchema.nullable(),
  home_team: id.nullable(),
  away_team: id.nullable(),
  lines: z.array(LineInterpretationSchema),
  needs_review: z.boolean(),
  ambiguities: z.array(id),
});
export const MatchPayloadSchema = z.strictObject({
  match_id: MatchIdSchema,
  home_team_id: id,
  away_team_id: id,
  lines: z
    .array(
      z.strictObject({
        position: id,
        home_player_ids: z.array(id).min(1).max(2),
        away_player_ids: z.array(id).min(1).max(2),
        sets: z
          .array(
            z.strictObject({
              set_number: z.number().int().positive(),
              kind: z.enum(["games", "match_tiebreak"]),
              home: score,
              away: score,
            }),
          )
          .min(1),
        winner: side,
        status: z.literal("completed"),
      }),
    )
    .min(1),
});
export const ValidationIssueSchema = z.strictObject({
  code: id,
  path: z.string(),
  message: id,
});
export const ValidatedMatchSchema = z
  .strictObject({
    kind: z.literal("validated"),
    payload: MatchPayloadSchema,
    context_hash: id,
    interpretation_hash: id,
    rules_hash: id,
    validated_at: z.iso.datetime(),
  })
  .brand<"ValidatedMatch">();
export const ApprovedMatchSchema = z
  .strictObject({
    kind: z.literal("approved"),
    validation: ValidatedMatchSchema,
    approval_id: z.uuid(),
    approved_by: id,
    approved_at: z.iso.datetime(),
  })
  .brand<"ApprovedMatch">();
export type OfficialMatchContext = z.infer<typeof OfficialMatchContextSchema>;
export type InterpretedScoreSheet = z.infer<typeof InterpretedScoreSheetSchema>;
export type MatchPayload = z.infer<typeof MatchPayloadSchema>;
export type ValidatedMatch = z.infer<typeof ValidatedMatchSchema>;
export type ApprovedMatch = z.infer<typeof ApprovedMatchSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type MatchDiscovery = z.infer<typeof MatchDiscoverySchema>;
