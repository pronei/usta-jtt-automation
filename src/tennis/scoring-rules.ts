import { z } from "zod";
export const ScoringRuleSchema = z
  .strictObject({
    id: z.string().min(1),
    sets_to_win: z.number().int().min(1).max(3),
    games_to_win: z.number().int().min(1),
    tiebreak_at: z.number().int().min(1).nullable(),
    deciding_match_tiebreak_to: z.number().int().min(2).nullable(),
    allow_player_reuse: z.boolean(),
  })
  .refine(
    (r) => r.tiebreak_at === null || r.tiebreak_at >= r.games_to_win - 1,
    "Invalid tiebreak threshold",
  )
  .refine(
    (r) => r.deciding_match_tiebreak_to === null || r.sets_to_win >= 2,
    "Deciding match tiebreak requires a multi-set format",
  );
export const RuleBookSchema = z
  .array(ScoringRuleSchema)
  .min(1)
  .refine(
    (r) => new Set(r.map((x) => x.id)).size === r.length,
    "Duplicate rule IDs",
  );
export type ScoringRule = z.infer<typeof ScoringRuleSchema>;
export function completedGames(h: number, a: number, r: ScoringRule): boolean {
  const hi = Math.max(h, a),
    lo = Math.min(h, a);
  if (
    r.tiebreak_at !== null &&
    hi === r.tiebreak_at + 1 &&
    lo === r.tiebreak_at
  )
    return true;
  return (
    hi >= r.games_to_win &&
    hi - lo >= 2 &&
    (hi === r.games_to_win || hi - lo === 2) &&
    (r.tiebreak_at === null || (hi <= r.tiebreak_at + 1 && lo < r.tiebreak_at))
  );
}
/** A score the format can reach while the set is still unfinished. */
export function partialGames(h: number, a: number, r: ScoringRule): boolean {
  if (completedGames(h, a, r)) return false;
  const hi = Math.max(h, a),
    lo = Math.min(h, a);
  if (r.tiebreak_at === null) return hi < r.games_to_win || hi - lo <= 1;
  return hi <= r.tiebreak_at && (hi < r.games_to_win || hi - lo <= 1);
}
