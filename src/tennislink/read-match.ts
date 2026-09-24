import type { Page } from "playwright";
import {
  OfficialMatchContextSchema,
  MatchIdSchema,
  type OfficialMatchContext,
} from "../domain/schemas.js";
import type { Selectors } from "./selectors.js";
import { readRoster } from "./read-roster.js";
import { assertTennisLinkPage } from "./find-match.js";
export async function readMatch(
  page: Page,
  matchId: string,
  s: Selectors,
  ruleByPosition: Readonly<Record<string, string>>,
): Promise<OfficialMatchContext> {
  MatchIdSchema.parse(matchId);
  assertTennisLinkPage(page);
  await page.locator(s.match_ready).waitFor({ state: "visible" });
  const text = async (selector: string) =>
    (await page.locator(selector).innerText()).trim();
  const id = await text(s.match_id);
  if (id !== matchId) throw new Error("Match changed before capture");
  const team = async (side: "home" | "away") => ({
    team_id: await text(s[side].team_id),
    team_name: await text(s[side].team_name),
    roster: await readRoster(page, s[side].roster_options),
  });
  const rows = page.locator(s.line_rows);
  const lines = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i),
      position = (await row.locator(s.line_position).innerText()).trim();
    const type = (await row.locator(s.line_type).innerText())
      .trim()
      .toLowerCase();
    if (type !== "singles" && type !== "doubles")
      throw new Error("Unrecognized official line type");
    if (!ruleByPosition[position])
      throw new Error(`No scoring format configured for ${position}`);
    lines.push({
      position,
      type,
      players_per_side: type === "singles" ? 1 : 2,
      scoring_rule_id: ruleByPosition[position],
    });
  }
  const status = await text(s.result_status);
  const context = OfficialMatchContextSchema.parse({
    match_id: id,
    date: s.date ? await text(s.date) : null,
    home_team: await team("home"),
    away_team: await team("away"),
    expected_lines: lines,
    captured_at: new Date().toISOString(),
    source_url: page.url(),
    result_status:
      status === s.unreported_text
        ? "unreported"
        : status === s.reported_text
          ? "reported"
          : "unknown",
  });
  assertTennisLinkPage(page);
  if ((await text(s.match_id)) !== id)
    throw new Error("Match changed during capture");
  return context;
}
