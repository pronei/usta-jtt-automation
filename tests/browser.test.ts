import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { findMatch } from "../src/tennislink/find-match.js";
import { readMatch } from "../src/tennislink/read-match.js";
import type { Selectors } from "../src/tennislink/selectors.js";
const selectors: Selectors = {
  entry_ready: "#entry",
  match_number_input: "input",
  lookup_button: "button",
  match_ready: "#match",
  match_id: "#id",
  date: null,
  result_status: "#status",
  unreported_text: "Unreported",
  reported_text: "Reported",
  home: { team_id: "#hid", team_name: "#home", roster_options: "#hr option" },
  away: { team_id: "#aid", team_name: "#away", roster_options: "#ar option" },
  line_rows: ".line",
  line_position: ".position",
  line_type: ".type",
};
test("Playwright finds exact match and reads fixture roster and line context", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<div id="entry"><input><button onclick="document.querySelector('#match').hidden=false">Lookup</button></div>
      <div id="match" hidden><b id="id">123456</b><b id="status">Unreported</b><b id="hid">h</b><b id="home">Momentum Tennis</b><b id="aid">a</b><b id="away">Away Club</b>
      <select id="hr"><option value="">Select</option><option value="h1">Home Player</option></select><select id="ar"><option value="a1">Away Player</option></select>
      <div class="line"><b class="position">1S</b><b class="type">Singles</b></div></div>`,
      }),
    );
    await page.goto("https://tennislink.usta.com/fixture");
    await findMatch(page, "123456", selectors);
    const result = await readMatch(page, "123456", selectors, {
      "1S": "standard",
    });
    assert.equal(result.home_team.roster[0]?.player_id, "h1");
    assert.equal(result.expected_lines[0]?.players_per_side, 1);
    await assert.rejects(
      readMatch(page, "999", selectors, { "1S": "standard" }),
      /Match changed/,
    );
    await assert.rejects(
      readMatch(page, "123456", selectors, {}),
      /No scoring format/,
    );
  } finally {
    await browser.close();
  }
});

test("score-list fixture filters both sides and preserves raw score text", async () => {
  const { readAcademyScores } =
    await import("../src/tennislink/read-scores.js");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
      <table id="scores"><tbody>
      <tr><td class="id">123</td><td class="home">Momentum Tennis 12U</td><td class="away">Other</td><td class="hs">36</td><td class="as">19</td></tr>
      <tr><td class="id">456</td><td class="home">Other</td><td class="away">Momentum Tennis 10U</td><td class="hs">0</td><td class="as"></td></tr>
      <tr><td class="id">789</td><td class="home">Unrelated</td><td class="away">Other</td><td class="hs">4</td><td class="as">2</td></tr>
      </tbody></table>`,
      }),
    );
    await page.goto("https://tennislink.usta.com/fixture-scores");
    const result = await readAcademyScores(
      page,
      {
        ready: "#scores",
        rows: "#scores tbody tr",
        empty: null,
        match_id: ".id",
        date: null,
        status: null,
        home: { name: ".home", id: null, score: ".hs" },
        away: { name: ".away", id: null, score: ".as" },
        detail_link: null,
        next_page_link: null,
      },
      { name: "Momentum Tennis", aliases: [], team_ids: [] },
    );
    assert.deepEqual(
      result.matches.map((r) => r.match_id),
      ["123", "456"],
    );
    assert.equal(result.matches[1]!.home.score_text, "0");
    assert.equal(result.matches[1]!.away.score_text, null);
  } finally {
    await browser.close();
  }
});
