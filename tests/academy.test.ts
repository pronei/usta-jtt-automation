import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "playwright";
import { loadLocalEnv, readCredentials } from "../src/env.js";
import { loadConfig } from "../src/config.js";
import { matchesAcademy } from "../src/tennislink/academy.js";
import { LoginSelectorsSchema } from "../src/tennislink/login.js";
import {
  readAcademyScores,
  readCurrentScores,
  trustedScoreUrl,
  type ScoreListSelectors,
} from "../src/tennislink/read-scores.js";
const academy = { name: "Momentum Tennis", aliases: [], team_ids: [] };
test("academy names are token-bounded, case-insensitive and punctuation-normalized", () => {
  assert.equal(
    matchesAcademy(
      { team_id: null, team_name: "MOMENTUM  Tennis - 12U Green B" },
      academy,
    ),
    true,
  );
  assert.equal(
    matchesAcademy({ team_id: null, team_name: "NotMomentum Tennis" }, academy),
    false,
  );
  assert.equal(
    matchesAcademy({ team_id: null, team_name: "Other Academy" }, academy),
    false,
  );
  assert.equal(
    matchesAcademy(
      { team_id: null, team_name: "MT Academy 10U" },
      { ...academy, aliases: ["MT Academy"] },
    ),
    true,
  );
});
test("explicit team IDs override fuzzy name matching", () => {
  const filter = { ...academy, team_ids: ["123"] };
  assert.equal(
    matchesAcademy({ team_id: "123", team_name: "Renamed team" }, filter),
    true,
  );
  assert.equal(
    matchesAcademy({ team_id: null, team_name: "Momentum Tennis" }, filter),
    false,
  );
  assert.equal(
    matchesAcademy({ team_id: "999", team_name: "Momentum Tennis" }, filter),
    false,
  );
});
test("default config excludes secrets and accepts another academy", () => {
  const config = loadConfig({
    USTA_USERNAME: "sample",
    USTA_PASSWORD: "sample-secret",
    ACADEMY_NAME: "Other Academy",
    ACADEMY_TEAM_IDS: "12, 34",
  });
  assert.equal(config.academy.name, "Other Academy");
  assert.deepEqual(config.academy.team_ids, ["12", "34"]);
  assert.equal(JSON.stringify(config).includes("sample-secret"), false);
  assert.equal(loadConfig({}).academy.name, "Momentum Tennis");
});
test("local env preserves runtime values, including quoted passwords", () => {
  const dir = mkdtempSync(join(tmpdir(), "momentum-env-")),
    key = "MOMENTUM_ENV_TEST_VALUE";
  const previous = process.env[key];
  try {
    const path = join(dir, ".env");
    writeFileSync(path, `${key}="file # value"\n`);
    delete process.env[key];
    loadLocalEnv(path);
    assert.equal(process.env[key], "file # value");
    process.env[key] = "runtime";
    loadLocalEnv(path);
    assert.equal(process.env[key], "runtime");
    loadLocalEnv(join(dir, "absent"));
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("credentials must be a complete pair; errors do not expose supplied values", () => {
  assert.equal(readCredentials({}), null);
  assert.throws(
    () => readCredentials({ USTA_PASSWORD: "private-test-value" }),
    (e) => e instanceof Error && !e.message.includes("private-test-value"),
  );
  assert.deepEqual(
    readCredentials({
      USTA_USERNAME: "user",
      USTA_PASSWORD: "quoted # password",
    }),
    { username: "user", password: "quoted # password" },
  );
});
test("rejects off-site, script and misleading-host links and login origins", () => {
  for (const url of [
    "https://evil.test",
    "javascript:alert(1)",
    "https://tennislink.usta.com.evil.test",
    "http://tennislink.usta.com",
    "https://user:password@tennislink.usta.com",
  ])
    assert.throws(() => trustedScoreUrl(url));
  assert.equal(
    trustedScoreUrl("?page=2", "https://tennislink.usta.com/results"),
    "https://tennislink.usta.com/results?page=2",
  );
  assert.throws(() =>
    LoginSelectorsSchema.parse({
      origin: "https://usta.com.evil.test",
      username: "u",
      password: "p",
    }),
  );
});
const selectors: ScoreListSelectors = {
  ready: "ready",
  rows: "rows",
  empty: "empty",
  match_id: "id",
  date: "date",
  status: "status",
  home: { name: "hn", id: null, score: "hs" },
  away: { name: "an", id: null, score: "as" },
  detail_link: null,
  next_page_link: "next",
};
function fakePage(
  pages: Array<{
    rows: Array<Record<string, string>>;
    next?: string;
    empty?: boolean;
  }>,
) {
  let index = 0;
  const root = "https://tennislink.usta.com/results";
  const page = {
    url: () => `${root}?page=${index + 1}`,
    goto: async (url: string) => {
      index = Number(new URL(url).searchParams.get("page")) - 1;
    },
    locator: (selector: string) => ({
      waitFor: async () => {},
      count: async () =>
        selector === "rows"
          ? pages[index]!.rows.length
          : selector === "next"
            ? pages[index]!.next
              ? 1
              : 0
            : 1,
      isVisible: async () => pages[index]!.empty === true,
      getAttribute: async (name: string) =>
        name === "href" ? (pages[index]!.next ?? null) : null,
      nth: (i: number) => ({
        locator: (name: string) => ({
          innerText: async () => pages[index]!.rows[i]![name] ?? "",
        }),
      }),
    }),
  };
  return page as unknown as Page;
}
const row = (id: string, home: string, away: string) => ({
  id,
  hn: home,
  an: away,
  hs: "0",
  as: "",
  status: "Scheduled",
  date: "09/20/26",
});
test("reads relevant home/away teams, preserves zero and blanks, and bounds pagination", async () => {
  const page = fakePage([
    {
      rows: [
        row("1", "Momentum Tennis 12U", "Other"),
        row("2", "Other", "Unrelated"),
      ],
      next: "?page=2",
    },
    { rows: [row("3", "Other", "Momentum Tennis 10U")] },
  ]);
  const result = await readAcademyScores(page, selectors, academy);
  assert.deepEqual(
    result.matches.map((m) => m.match_id),
    ["1", "3"],
  );
  assert.equal(result.rows_examined, 3);
  assert.equal(result.matches[0]!.home.score_text, "0");
  assert.equal(result.matches[0]!.away.score_text, null);
  assert.equal(result.truncated, false);
  const limited = await readAcademyScores(
    fakePage([
      { rows: [row("1", "Momentum Tennis", "Other")], next: "?page=2" },
    ]),
    selectors,
    academy,
    1,
  );
  assert.equal(limited.truncated, true);
  assert.equal(limited.pages_read, 1);
});
test("empty listings require a verified empty state; pagination loops fail", async () => {
  await assert.rejects(
    readCurrentScores(fakePage([{ rows: [] }]), selectors),
    /No score rows/,
  );
  assert.deepEqual(
    await readCurrentScores(fakePage([{ rows: [], empty: true }]), selectors),
    [],
  );
  await assert.rejects(
    readAcademyScores(
      fakePage([
        { rows: [row("1", "Momentum Tennis", "Other")], next: "?page=1" },
      ]),
      selectors,
      academy,
    ),
    /loop/,
  );
});
