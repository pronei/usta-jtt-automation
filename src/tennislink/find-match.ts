import type { Page } from "playwright";
import { MatchIdSchema } from "../domain/schemas.js";
import type { Selectors } from "./selectors.js";
export function assertTennisLinkPage(page: Page) {
  const url = new URL(page.url());
  if (url.protocol !== "https:" || url.hostname !== "tennislink.usta.com")
    throw new Error("Authentication required or unexpected origin");
}
export async function findMatch(
  page: Page,
  matchId: string,
  s: Selectors,
): Promise<void> {
  MatchIdSchema.parse(matchId);
  assertTennisLinkPage(page);
  await page.locator(s.entry_ready).waitFor({ state: "visible" });
  await page.locator(s.match_number_input).fill(matchId);
  await page.locator(s.lookup_button).click();
  await page.locator(s.match_ready).waitFor({ state: "visible" });
  assertTennisLinkPage(page);
  if ((await page.locator(s.match_id).innerText()).trim() !== matchId)
    throw new Error("Official match ID does not match request");
}
