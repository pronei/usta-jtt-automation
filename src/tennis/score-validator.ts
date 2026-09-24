import {
  InterpretedScoreSheetSchema,
  OfficialMatchContextSchema,
  ValidatedMatchSchema,
  type ValidatedMatch,
  type ValidationIssue,
  type MatchPayload,
} from "../domain/schemas.js";
import { fingerprint } from "../domain/fingerprint.js";
import { RuleBookSchema, completedGames } from "./scoring-rules.js";
export type ValidationResult =
  | { valid: true; value: ValidatedMatch; issues: [] }
  | { valid: false; issues: ValidationIssue[] };
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
    if (line.status !== "completed")
      fail(
        "UNSUPPORTED_STATUS",
        path,
        "Retirement/default/walkover requires a dedicated rule implementation",
      );
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
    let homeWins = 0,
      awayWins = 0;
    for (const [i, set] of line.sets.entries()) {
      if (homeWins === rule.sets_to_win || awayWins === rule.sets_to_win)
        fail("EXTRA_SET", path, "Match already decided");
      if (
        set.set_number !== i + 1 ||
        set.needs_review ||
        set.ambiguity ||
        set.home === null ||
        set.away === null
      ) {
        fail("UNRESOLVED_SCORE", path, "Missing or ambiguous score/sequence");
        continue;
      }
      const deciding =
        rule.deciding_match_tiebreak_to !== null &&
        homeWins === rule.sets_to_win - 1 &&
        awayWins === rule.sets_to_win - 1;
      const hi = Math.max(set.home, set.away),
        lo = Math.min(set.home, set.away),
        target = rule.deciding_match_tiebreak_to;
      const legal = deciding
        ? set.kind === "match_tiebreak" &&
          target !== null &&
          hi >= target &&
          hi - lo >= 2 &&
          (hi === target || hi - lo === 2)
        : set.kind === "games" && completedGames(set.home, set.away, rule);
      if (!legal)
        fail(
          "INVALID_SET",
          `${path}.sets.${i}`,
          "Score is not a completed set under the configured format",
        );
      if (set.home > set.away) homeWins++;
      else if (set.away > set.home) awayWins++;
    }
    if (
      Math.max(homeWins, awayWins) !== rule.sets_to_win ||
      homeWins === awayWins
    )
      fail("INCOMPLETE_MATCH", path, "No valid match winner");
    const winner = homeWins > awayWins ? "home" : "away";
    if (line.observed_winner !== null && line.observed_winner !== winner)
      fail("WINNER_MISMATCH", path, "Observed winner conflicts with scores");
    payload.lines.push({
      position: line.position,
      home_player_ids: line.home_players.map((p) => p.roster_player_id ?? ""),
      away_player_ids: line.away_players.map((p) => p.roster_player_id ?? ""),
      sets: line.sets.map((s) => ({
        set_number: s.set_number,
        kind: s.kind,
        home: s.home ?? 0,
        away: s.away ?? 0,
      })),
      winner,
      status: "completed",
    });
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
