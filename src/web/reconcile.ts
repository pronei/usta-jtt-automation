import { z } from "zod";
import type { ObservedCard } from "../pipeline/dry-run.js";
import {
  InterpretedScoreSheetSchema,
  ResultStatusSchema,
  type InterpretedScoreSheet,
  type MatchPayload,
  type OfficialMatchContext,
  type ResultStatus,
} from "../domain/schemas.js";
import { completedGames, partialGames, type ScoringRule } from "../tennis/scoring-rules.js";

export type Candidate = { player_id: string; display_name: string };
export type Slot = {
  observed: string;
  resolution: "exact" | "probable" | "ambiguous" | "unresolved";
  chosen: string | null;
  candidates: Candidate[];
};
export type DraftLine = {
  position: string;
  type: "singles" | "doubles";
  found: boolean;
  home: Slot[];
  away: Slot[];
  home_games: number | null;
  away_games: number | null;
  suggested_status: ResultStatus | "unknown";
  suggested_winner: "home" | "away" | null;
};
export type Draft = { lines: DraftLine[] };

const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** Exact full name → exact; every printed token a prefix of one roster name → probable; several → ambiguous. */
export function matchName(observed: string, roster: Candidate[]): Slot {
  const t = tokens(observed);
  const exact = roster.filter((r) => tokens(r.display_name).join(" ") === t.join(" "));
  if (t.length && exact.length === 1)
    return { observed, resolution: "exact", chosen: exact[0]!.player_id, candidates: exact };
  const candidates = t.length
    ? roster.filter((r) => {
        const rt = tokens(r.display_name);
        return t.every((x) => rt.some((y) => y.startsWith(x)));
      })
    : [];
  if (candidates.length === 1)
    return { observed, resolution: "probable", chosen: candidates[0]!.player_id, candidates };
  return {
    observed,
    resolution: candidates.length ? "ambiguous" : "unresolved",
    chosen: null,
    candidates,
  };
}

export function orientCard(card: ObservedCard, swapped: boolean): ObservedCard {
  if (!swapped) return card;
  return {
    ...card,
    home_team: card.away_team,
    away_team: card.home_team,
    printed_home_total: card.printed_away_total,
    printed_away_total: card.printed_home_total,
    lines: card.lines.map((l) => ({
      ...l,
      home_names: l.away_names,
      away_names: l.home_names,
      home_games: l.away_games,
      away_games: l.home_games,
    })),
  };
}

const position = (p: string) => p.replace(/\s+/g, " ").trim();

export function draftFromCard(
  card: ObservedCard,
  ctx: OfficialMatchContext,
  rules: ScoringRule[],
): Draft {
  return {
    lines: ctx.expected_lines.map((expected) => {
      const rule = rules.find((r) => r.id === expected.scoring_rule_id);
      const line = card.lines.find((l) => position(l.position_text) === position(expected.position));
      const slots = (names: string[], roster: Candidate[]) =>
        Array.from({ length: expected.players_per_side }, (_, i) =>
          matchName(names[i] ?? "", roster),
        );
      if (!line)
        return {
          position: expected.position,
          type: expected.type,
          found: false,
          home: slots([], ctx.home_team.roster),
          away: slots([], ctx.away_team.roster),
          home_games: null,
          away_games: null,
          suggested_status: "unknown" as const,
          suggested_winner: null,
        };
      // A card exported from the platform carries the coach's result and winner; a parsed PDF does not.
      const suggested_status: DraftLine["suggested_status"] =
        line.result ??
        (!rule || line.home_games === null || line.away_games === null
          ? "unknown"
          : completedGames(line.home_games, line.away_games, rule)
            ? "completed"
            : partialGames(line.home_games, line.away_games, rule)
              ? "timed"
              : "unknown");
      return {
        position: expected.position,
        type: expected.type,
        found: true,
        home: slots(line.home_names, ctx.home_team.roster),
        away: slots(line.away_names, ctx.away_team.roster),
        home_games: line.home_games,
        away_games: line.away_games,
        suggested_status,
        suggested_winner:
          line.winner ??
          (line.home_games === null ||
          line.away_games === null ||
          line.home_games === line.away_games
            ? null
            : line.home_games > line.away_games
              ? "home"
              : "away"),
      };
    }),
  };
}

export const ReviewLineSchema = z.strictObject({
  home: z.array(z.string()).min(1).max(2),
  away: z.array(z.string()).min(1).max(2),
  home_games: z.number().int().nonnegative().nullable(),
  away_games: z.number().int().nonnegative().nullable(),
  status: z.enum([...ResultStatusSchema.options, "unknown"]),
  winner: z.enum(["home", "away"]).nullable(),
});
export const ReviewSchema = z.strictObject({ lines: z.array(ReviewLineSchema).min(1) });
export type Review = z.infer<typeof ReviewSchema>;

/** Field names: l{i}.home.{k}, l{i}.away.{k}, l{i}.home_games, l{i}.away_games, l{i}.status, l{i}.winner */
export function reviewFromForm(params: URLSearchParams, draft: Draft): Review {
  const num = (v: string | null) => (v === null || v.trim() === "" ? null : Number(v));
  return ReviewSchema.parse({
    lines: draft.lines.map((l, i) => ({
      home: l.home.map((_, k) => params.get(`l${i}.home.${k}`) ?? ""),
      away: l.away.map((_, k) => params.get(`l${i}.away.${k}`) ?? ""),
      home_games: num(params.get(`l${i}.home_games`)),
      away_games: num(params.get(`l${i}.away_games`)),
      status: params.get(`l${i}.status`) ?? "unknown",
      winner: params.get(`l${i}.winner`) || null,
    })),
  });
}

export function sheetFromReview(
  review: Review,
  draft: Draft,
  card: ObservedCard,
  ctx: OfficialMatchContext,
): InterpretedScoreSheet {
  const player = (id: string, observed: string, roster: Candidate[]) => {
    const r = roster.find((p) => p.player_id === id);
    return r
      ? {
          observed_text: observed || null,
          roster_player_id: r.player_id,
          roster_name: r.display_name,
          resolution: "exact" as const,
          candidate_player_ids: [],
          needs_review: false,
          ambiguity: null,
        }
      : {
          observed_text: observed || null,
          roster_player_id: null,
          roster_name: null,
          resolution: "unresolved" as const,
          candidate_player_ids: [],
          needs_review: true,
          ambiguity: "No roster player chosen",
        };
  };
  return InterpretedScoreSheetSchema.parse({
    match_id: card.match_id,
    home_team: ctx.home_team.team_name,
    away_team: ctx.away_team.team_name,
    lines: review.lines.map((l, i) => {
      const d = draft.lines[i]!;
      const scored = l.home_games !== null && l.away_games !== null;
      const noScores = l.status === "double_default" || (l.status === "default" && !scored);
      return {
        position: d.position,
        home_players: l.home.map((id, k) => player(id, d.home[k]?.observed ?? "", ctx.home_team.roster)),
        away_players: l.away.map((id, k) => player(id, d.away[k]?.observed ?? "", ctx.away_team.roster)),
        sets: noScores
          ? []
          : [
              {
                set_number: 1,
                kind: "games",
                home: l.home_games,
                away: l.away_games,
                needs_review: !scored,
                ambiguity: scored ? null : "No score",
              },
            ],
        observed_winner: l.winner,
        status: l.status,
        needs_review: false,
        ambiguities: [],
      };
    }),
    needs_review: false,
    ambiguities: [],
  });
}

export type ErrorsCaught = {
  roster_mismatch: number;
  status_not_completed: number;
  winner_first_reorder: number;
  totals_mismatch: number;
  score_edited: number;
  total: number;
};

/** What the reviewer changed relative to the printed card, plus what the form would have got wrong by default. */
export function errorsCaught(
  draft: Draft,
  card: ObservedCard,
  sheet: InterpretedScoreSheet,
  payload: MatchPayload,
): ErrorsCaught {
  let roster_mismatch = 0,
    score_edited = 0;
  draft.lines.forEach((d, i) => {
    const s = sheet.lines[i]!;
    const check = (slots: Slot[], players: InterpretedScoreSheet["lines"][number]["home_players"]) =>
      slots.forEach((slot, k) => {
        if (slot.resolution !== "exact" || slot.chosen !== (players[k]?.roster_player_id ?? null))
          roster_mismatch++;
      });
    check(d.home, s.home_players);
    check(d.away, s.away_players);
    const set = s.sets[0];
    if (set && (set.home !== d.home_games || set.away !== d.away_games)) score_edited++;
  });
  const status_not_completed = payload.lines.filter((l) => l.status !== "completed").length;
  const winner_first_reorder = payload.lines.filter((l) => l.winner === "away").length;
  const home = card.lines.reduce((n, l) => n + (l.home_games ?? 0), 0),
    away = card.lines.reduce((n, l) => n + (l.away_games ?? 0), 0);
  const totals_mismatch =
    home !== card.printed_home_total || away !== card.printed_away_total ? 1 : 0;
  return {
    roster_mismatch,
    status_not_completed,
    winner_first_reorder,
    totals_mismatch,
    score_edited,
    total: roster_mismatch + status_not_completed + winner_first_reorder + totals_mismatch + score_edited,
  };
}
