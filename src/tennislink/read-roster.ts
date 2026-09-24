import type { Page } from "playwright";
import { RosterPlayerSchema } from "../domain/schemas.js";
export async function readRoster(page: Page, optionSelector: string) {
  const options = page.locator(optionSelector);
  await options.first().waitFor({ state: "attached" });
  const entries = await options.evaluateAll((nodes) =>
    nodes.map((n) => ({
      player_id: n.getAttribute("value") ?? "",
      display_name: n.textContent?.trim() ?? "",
      disabled: n.hasAttribute("disabled"),
    })),
  );
  const result = entries
    .filter((x) => x.player_id !== "" && !x.disabled)
    .map(({ player_id, display_name }) =>
      RosterPlayerSchema.parse({ player_id, display_name }),
    );
  if (
    !result.length ||
    new Set(result.map((p) => p.player_id)).size !== result.length
  )
    throw new Error("Empty or duplicate roster; inspect selectors");
  return result;
}
