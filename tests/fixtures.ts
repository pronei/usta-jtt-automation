import type {
  OfficialMatchContext,
  InterpretedScoreSheet,
} from "../src/domain/schemas.js";
export const context: OfficialMatchContext = {
  match_id: "123456",
  date: "2026-09-17",
  home_team: {
    team_id: "h",
    team_name: "Momentum Tennis",
    roster: [{ player_id: "h1", display_name: "Home Player" }],
  },
  away_team: {
    team_id: "a",
    team_name: "Away Club",
    roster: [{ player_id: "a1", display_name: "Away Player" }],
  },
  expected_lines: [
    {
      position: "1S",
      type: "singles",
      players_per_side: 1,
      scoring_rule_id: "standard",
    },
  ],
  captured_at: "2026-09-17T12:00:00.000Z",
  source_url: "https://tennislink.usta.com/test",
  result_status: "unreported",
};
export const rules = [
  {
    id: "standard",
    sets_to_win: 2,
    games_to_win: 6,
    tiebreak_at: 6,
    deciding_match_tiebreak_to: 10,
    allow_player_reuse: false,
  },
];
const player = (id: string, name: string) => ({
  observed_text: name,
  roster_player_id: id,
  roster_name: name,
  resolution: "exact" as const,
  candidate_player_ids: [],
  needs_review: false,
  ambiguity: null,
});
export const sheet: InterpretedScoreSheet = {
  match_id: "123456",
  home_team: "Momentum Tennis",
  away_team: "Away Club",
  lines: [
    {
      position: "1S",
      home_players: [player("h1", "Home Player")],
      away_players: [player("a1", "Away Player")],
      sets: [
        {
          set_number: 1,
          kind: "games",
          home: 6,
          away: 4,
          needs_review: false,
          ambiguity: null,
        },
        {
          set_number: 2,
          kind: "games",
          home: 6,
          away: 3,
          needs_review: false,
          ambiguity: null,
        },
      ],
      observed_winner: "home",
      status: "completed",
      needs_review: false,
      ambiguities: [],
    },
  ],
  needs_review: false,
  ambiguities: [],
};
