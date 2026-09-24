import {
  InterpretedScoreSheetSchema,
  OfficialMatchContextSchema,
  ValidatedMatchSchema,
  type ValidatedMatch,
  type ValidationIssue,
  type MatchPayload,
} from "../domain/schemas.js";
import { fingerprint } from "../domain/fingerprint.js";
import {
  RuleBookSchema,
  completedGames,
  partialGames,
  type ScoringRule,
} from "./scoring-rules.js";
export type ValidationResult =
  | { valid: true; value: ValidatedMatch; issues: [] }
  | { valid: false; issues: ValidationIssue[] };
type SetState = "completed" | "partial" | "invalid";
function setState(
  set: { kind: "games" | "match_tiebreak"; home: number; away: number },
  rule: ScoringRule,
  deciding: boolean,
): SetState {
  const hi = Math.max(set.home, set.away),
    lo = Math.min(set.home, set.away);
  if (deciding) {
    const target = rule.deciding_match_tiebreak_to;
    if (set.kind !== "match_tiebreak" || target === null) return "invalid";
    if (hi >= target && hi - lo >= 2 && (hi === target || hi - lo === 2))
      return "completed";
    return hi < target || hi - lo <= 1 ? "partial" : "invalid";
  }
  if (set.kind !== "games") return "invalid";
  if (completedGames(set.home, set.away, rule)) return "completed";
  return partialGames(set.home, set.away, rule) ? "partial" : "invalid";
}
export function validateScoreSheet(
  raw: unknown,
  official: unknown,
  rulesInput: unknown,
): ValidationResult {
  const sheet = InterpretedScoreSheetSchema.parse(raw),
    ctx = OfficialMatchContextSchema.parse(official),
    rules = RuleBookSchema.parse(rulesInput);
  const issues: ValidationIssue[] = [];
  const fail = (code: string, path: string, message: string) => {
    issues.push({ code, path, message });
  };
  if (sheet.match_id !== ctx.match_id)
    fail("MATCH_MISMATCH", "match_id", "Match ID must match official context");
  if (
    sheet.home_team !== ctx.home_team.team_name ||
    sheet.away_team !== ctx.away_team.team_name
  )
    fail("TEAM_MISMATCH", "teams", "Resolve team names and orientation");
  if (sheet.needs_review || sheet.ambiguities.length)
    fail("UNRESOLVED", "", "Sheet needs human correction");
  if (
    sheet.lines.length !== ctx.expected_lines.length ||
    new Set(sheet.lines.map((l) => l.position)).size !== sheet.lines.length
  )
    fail("LINE_STRUCTURE", "lines", "Missing or duplicate lines");
  const payload: MatchPayload = {
    match_id: ctx.match_id,
    home_team_id: ctx.home_team.team_id,
    away_team_id: ctx.away_team.team_id,
    lines: [],
  };
  const used = new Map<string, boolean>();
  for (const line of sheet.lines) {
    const path = `lines.${line.position}`,
      expected = ctx.expected_lines.find((l) => l.position === line.position);
    if (!expected) {
      fail("UNKNOWN_LINE", path, "Position not in official context");
      continue;
    }
    const rule = rules.find((r) => r.id === expected.scoring_rule_id);
    if (!rule) {
      fail("UNKNOWN_RULE", path, "Configure an explicit scoring rule");
      continue;
    }
    if (line.needs_review || line.ambiguities.length)
      fail("UNRESOLVED", path, "Line needs correction");
    for (const side of ["home", "away"] as const) {
      const players = line[`${side}_players`],
        roster = ctx[`${side}_team`].roster;
      if (
        players.length !== expected.players_per_side ||
        new Set(players.map((p) => p.roster_player_id)).size !== players.length
      )
        fail("PLAYER_COUNT", path, "Invalid or duplicate lineup");
      for (const p of players) {
        if (
          p.needs_review ||
          p.ambiguity ||
          p.resolution !== "exact" ||
          p.roster_player_id === null ||
          !roster.some(
            (r) =>
              r.player_id === p.roster_player_id &&
              r.display_name === p.roster_name,
          ) ||
          p.candidate_player_ids.some((x) => x !== p.roster_player_id)
        )
          fail(
            "PLAYER_IDENTITY",
            path,
            "Resolve player identity against correct roster",
          );
        const key = side + ":" + p.roster_player_id;
        if (used.has(key) && (!rule.allow_player_reuse || !used.get(key)))
          fail("PLAYER_REUSE", path, "Player used in multiple lines");
        used.set(key, rule.allow_player_reuse);
      }
    }
    if (line.status === "walkover" || line.status === "unknown") {
      fail(
        "UNSUPPORTED_STATUS",
        path,
        "Choose a result the form offers: completed, timed, retired, default or double default",
      );
      continue;
    }
    const status = line.status;
    const sets: MatchPayload["lines"][number]["sets"] = [];
    let unresolved = false;
    for (const [i, set] of line.sets.entries()) {
      if (
        set.set_number !== i + 1 ||
        set.needs_review ||
        set.ambiguity ||
        set.home === null ||
        set.away === null
      ) {
        fail("UNRESOLVED_SCORE", `${path}.sets.${i}`, "Missing or ambiguous score/sequence");
        unresolved = true;
        continue;
      }
      sets.push({ set_number: set.set_number, kind: set.kind, home: set.home, away: set.away });
    }
    if (unresolved) continue;
    const ids = {
      home_player_ids: line.home_players.map((p) => p.roster_player_id ?? ""),
      away_player_ids: line.away_players.map((p) => p.roster_player_id ?? ""),
    };
    if (status === "double_default") {
      if (sets.length) fail("SCORES_NOT_ALLOWED", path, "A double default records no scores");
      if (line.observed_winner !== null)
        fail("WINNER_NOT_ALLOWED", path, "A double default has no winner");
      payload.lines.push({ position: line.position, ...ids, sets: [], winner: null, status });
      continue;
    }
    if (status === "default" && sets.length === 0) {
      if (line.observed_winner === null)
        fail("WINNER_REQUIRED", path, "A default needs the reviewer to name the winner");
      payload.lines.push({
        position: line.position,
        ...ids,
        sets: [],
        winner: line.observed_winner,
        status,
      });
      continue;
    }
    if (sets.length === 0) {
      fail("UNRESOLVED_SCORE", path, "No scores recorded");
      continue;
    }
    let homeWins = 0,
      awayWins = 0,
      homeGames = 0,
      awayGames = 0,
      unfinished = false;
    for (const [i, set] of sets.entries()) {
      if (unfinished || homeWins === rule.sets_to_win || awayWins === rule.sets_to_win) {
        fail("EXTRA_SET", path, "Scores continue after the line was decided or stopped");
        break;
      }
      const deciding =
        rule.deciding_match_tiebreak_to !== null &&
        homeWins === rule.sets_to_win - 1 &&
        awayWins === rule.sets_to_win - 1;
      const state = setState(set, rule, deciding);
      if (state === "invalid")
        fail("INVALID_SET", `${path}.sets.${i}`, "Score is not reachable under the configured format");
      else if (state === "partial") unfinished = true;
      else if (set.home > set.away) homeWins++;
      else awayWins++;
      homeGames += set.home;
      awayGames += set.away;
    }
    const decided = Math.max(homeWins, awayWins) === rule.sets_to_win;
    let winner: "home" | "away" | null = null;
    if (status === "completed") {
      if (unfinished)
        fail(
          "INCOMPLETE_MATCH",
          path,
          "An unfinished set cannot be recorded as completed; choose timed or retired",
        );
      else if (!decided) fail("INCOMPLETE_MATCH", path, "No valid match winner");
      else winner = homeWins > awayWins ? "home" : "away";
    } else if (status === "timed") {
      if (decided)
        fail("STATUS_MISMATCH", path, "Scores describe a finished line; record it as completed");
      else if (homeGames !== awayGames) winner = homeGames > awayGames ? "home" : "away";
      else if (line.observed_winner === null)
        fail("TIMED_TIE", path, "Equal games; the reviewer must name the winner");
      else winner = line.observed_winner;
    } else {
      if (decided)
        fail("STATUS_MISMATCH", path, "Scores describe a finished line; record it as completed");
      else if (line.observed_winner === null)
        fail(
          "WINNER_REQUIRED",
          path,
          `A ${status === "retired" ? "retirement" : "default"} needs the reviewer to name the winner`,
        );
      else winner = line.observed_winner;
    }
    if (winner !== null && line.observed_winner !== null && line.observed_winner !== winner)
      fail("WINNER_MISMATCH", path, "Observed winner conflicts with scores");
    payload.lines.push({ position: line.position, ...ids, sets, winner, status });
  }
  if (issues.length) return { valid: false, issues };
  payload.lines.sort((a, b) => a.position.localeCompare(b.position));
  return {
    valid: true,
    issues: [],
    value: ValidatedMatchSchema.parse({
      kind: "validated",
      payload,
      context_hash: fingerprint(ctx),
      interpretation_hash: fingerprint(sheet),
      rules_hash: fingerprint(rules),
      validated_at: new Date().toISOString(),
    }),
  };
}
