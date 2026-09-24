import type { Locator, Page } from "playwright";
import { z } from "zod";
import { MatchIdSchema } from "../domain/schemas.js";
import { matchesAcademy, type AcademyFilter } from "./academy.js";
import { assertTennisLinkPage } from "./find-match.js";
const selector = z.string().min(1);
const teamSelectors = z.strictObject({
  name: selector,
  id: selector.nullable(),
  score: selector.nullable(),
});
export const ScoreListSelectorsSchema = z.strictObject({
  ready: selector,
  rows: selector,
  empty: selector.nullable(),
  match_id: selector,
  date: selector.nullable(),
  status: selector.nullable(),
  home: teamSelectors,
  away: teamSelectors,
  detail_link: selector.nullable(),
  next_page_link: selector.nullable(),
});
export type ScoreListSelectors = z.infer<typeof ScoreListSelectorsSchema>;
const team = z.strictObject({
  team_id: z.string().min(1).nullable(),
  team_name: z.string().min(1),
  score_text: z.string().nullable(),
});
export const CurrentScoreSchema = z.strictObject({
  match_id: MatchIdSchema,
  date_text: z.string().nullable(),
  status_text: z.string().nullable(),
  home: team,
  away: team,
  detail_url: z.url().nullable(),
  source_url: z.url(),
  captured_at: z.iso.datetime(),
});
export type CurrentScore = z.infer<typeof CurrentScoreSchema>;
async function text(root: Locator, s: string | null) {
  if (s === null) return null;
  const value = (await root.locator(s).innerText()).trim();
  return value || null;
}
export function trustedScoreUrl(raw: string, base?: string): string {
  const url = new URL(raw, base);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "tennislink.usta.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Score links must stay on HTTPS tennislink.usta.com");
  if (url.hash) url.hash = "";
  return url.href;
}
/** Read only the rendered listing. Raw scores are not assumed to mean sets, games, or wins. */
export async function readCurrentScores(
  page: Page,
  raw: unknown,
): Promise<CurrentScore[]> {
  const s = ScoreListSelectorsSchema.parse(raw);
  assertTennisLinkPage(page);
  await page.locator(s.ready).waitFor({ state: "visible" });
  const source = trustedScoreUrl(page.url()),
    rows = page.locator(s.rows),
    result: CurrentScore[] = [];
  const count = await rows.count();
  if (!count && !(s.empty && (await page.locator(s.empty).isVisible())))
    throw new Error(
      "No score rows and no verified empty-state marker; inspect selectors or authentication",
    );
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const readTeam = async (side: "home" | "away") => ({
      team_id: await text(row, s[side].id),
      team_name: await text(row, s[side].name),
      score_text: await text(row, s[side].score),
    });
    const href = s.detail_link
      ? await row.locator(s.detail_link).getAttribute("href")
      : null;
    result.push(
      CurrentScoreSchema.parse({
        match_id: await text(row, s.match_id),
        date_text: await text(row, s.date),
        status_text: await text(row, s.status),
        home: await readTeam("home"),
        away: await readTeam("away"),
        detail_url: href ? trustedScoreUrl(href, source) : null,
        source_url: source,
        captured_at: new Date().toISOString(),
      }),
    );
  }
  assertTennisLinkPage(page);
  if (trustedScoreUrl(page.url()) !== source)
    throw new Error("Score page changed during capture");
  if (new Set(result.map((r) => r.match_id)).size !== result.length)
    throw new Error("Duplicate match rows; inspect listing selectors");
  return result;
}
/** Bounded traversal of configured listing links; does not crawl unrelated team pages. */
export async function readAcademyScores(
  page: Page,
  s: ScoreListSelectors,
  filter: AcademyFilter,
  maxPages = 10,
) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("maxPages must be 1–100");
  const visited = new Set<string>(),
    matches = new Map<string, CurrentScore>();
  let rowsExamined = 0,
    nextPage: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const url = trustedScoreUrl(page.url());
    if (visited.has(url)) throw new Error("Pagination loop detected");
    visited.add(url);
    const rows = await readCurrentScores(page, s);
    rowsExamined += rows.length;
    for (const row of rows)
      if (
        matchesAcademy(row.home, filter) ||
        matchesAcademy(row.away, filter)
      ) {
        if (matches.has(row.match_id))
          throw new Error(
            "Duplicate match across pages; review overlapping listing",
          );
        matches.set(row.match_id, row);
      }
    nextPage = null;
    if (s.next_page_link) {
      const next = page.locator(s.next_page_link);
      if (await next.count()) {
        if ((await next.getAttribute("aria-disabled")) !== "true") {
          const href = await next.getAttribute("href");
          if (!href)
            throw new Error(
              "Pagination requires a real navigation link, not a postback control",
            );
          nextPage = trustedScoreUrl(href, url);
        }
      }
    }
    if (!nextPage || i + 1 === maxPages) break;
    await page.goto(nextPage);
  }
  return {
    academy: filter,
    scope: "configured_listing_pages_only",
    pages_read: visited.size,
    rows_examined: rowsExamined,
    pagination_configured: s.next_page_link !== null,
    truncated: nextPage !== null,
    next_page_url: nextPage,
    matches: [...matches.values()],
  };
}
