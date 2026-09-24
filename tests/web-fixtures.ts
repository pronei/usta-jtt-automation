import type { ObservedCard, Observations } from "../src/pipeline/dry-run.js";

export const card: ObservedCard = {
  page: 1,
  match_id: "123456",
  date_text: "09/13/26",
  time_text: "2:00 PM",
  division: "10U Green",
  home_team: "Momentum Tennis - 10U Green",
  away_team: "Away Club - 10U Green",
  location: "Test Park",
  rendered_path: "page-1.png",
  rendered_sha256: "b".repeat(64),
  lines: [
    {
      round: 1,
      position_text: "#1 Singles",
      home_names: ["Home Player"],
      away_names: ["Away Player"],
      home_games: 3,
      away_games: 1,
    },
    {
      round: 1,
      position_text: "#1 Doubles",
      home_names: ["Second Home", "Third Home"],
      away_names: ["Second Away", "Sam Li"],
      home_games: 4,
      away_games: 2,
    },
  ],
  printed_home_total: 7,
  printed_away_total: 3,
};
export const observations: Observations = {
  source_path: "source.pdf",
  source_sha256: "0".repeat(64),
  extraction_method: "test fixture",
  cards: [card],
};
