# Momentum Tennis — USTA score-sheet automation

TypeScript/Node.js + Playwright scaffold. Final submission is disabled by default. No live TennisLink credentials or private score sheets are included.

## Setup

Requires Node.js 24+ and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm build
```

`pnpm test` runs deterministic unit/integration tests. `pnpm test:browser` runs real Chromium against intercepted HTML. Neither connects to TennisLink. Dependencies are pinned by `pnpm-lock.yaml`.

## Architecture and implementation status

```text
original photo / scan [adapter contract]
  → preprocessing; preserve original, record transforms [adapter contract]
  → AI pass 1: match discovery [strict schema + adapter contract]
  → Playwright: find match / read teams, rosters, expected lines [implemented configurable readers]
  → AI pass 2: original image + official snapshot [strict schema + adapter contract]
  → deterministic validation [implemented]
  → human review and correction [service boundary; UI not implemented]
  → persisted approved JSON [implemented]
  → Playwright population [guarded service; live write adapter not implemented]
  → read-back verification [implemented service]
  → explicit confirmation + enabled flag + duplicate reservation
  → controlled submit / official receipt [implemented service; live click adapter not implemented]
  → append-only audit and immutable JSON artifacts [SQLite]
```

This is the initial repository scaffold, not an end-to-end production application. Image processing, model calls, authenticated review UI/API, pipeline runner, and live population/submit selectors are future work. The configuration does not choose a vision model automatically. No vision-model SDK integration is claimed or enabled.

## Read-only context capture

1. Copy `config/selectors.example.json` to `config/selectors.local.json`. Replace every placeholder with selectors verified in an authorized authenticated TennisLink session. The example contains **no verified production selectors**.
2. Copy `config/line-rules.example.json` to `config/line-rules.local.json`. Assign each official position a scoring rule verified for your league/section. Readers refuse unknown line types and absent mappings.
3. Use environment variables from `.env.example`. The capture and score-reader CLIs automatically load the local `.env` file; exported environment variables take precedence. Credentials are never stored in source code. The capture command still uses manual login. The browser profile contains authentication cookies and must remain private.
4. Run `pnpm capture 123456 config/line-rules.local.json`. Complete login, MFA, or CAPTCHA yourself in the opened browser. Return to score entry and press Enter in the terminal.
5. Inspect the resulting timestamped JSON under `var/context/`.

Selectors for IDs must return exact visible identifier text; roster selectors must target one complete select's option elements per team, with official player IDs in `value`. Empty/disabled placeholders are ignored. A placeholder with a nonempty value must be excluded explicitly by the configured selector. Line type text must read `Singles` or `Doubles`; extend the adapter for other portal representations. ASP.NET postbacks run through normal browser actions. The supplied entry URL must also be verified when calibrating the adapter.

The context reader captures official line positions/type and overlays operator-configured scoring rule IDs; it does not infer league rules from the web page. Unknown result status is captured as `unknown` and blocks writes.

## Validation and approval

`src/domain/schemas.ts` separates nullable AI interpretation, official context, validated payload, and branded approved records. AI output cannot be passed to population without an approval record persisted in the store. Brands provide compile-time protection; database lookup and content comparison detect fabricated or modified approvals at runtime. These are internal trusted services, not an authentication system: a future API must derive reviewer identity from its authenticated session, never from arbitrary client JSON.

`validateScoreSheet` requires exact roster identities, complete expected lines, explicit scoring rules, resolved ambiguities, legal completed sets and a computed winner. It binds the result to hashes of the interpretation, context and rules. Human edits must be retained as a new artifact, revalidated, and approved anew. Do not overwrite raw AI evidence. No unresolved path may transition directly to approval.

Scoring examples support standard sets, short sets, pro sets, advantage sets (`tiebreak_at: null`) and a deciding match tiebreak. They are illustrative configurations, **not authoritative USTA regulations**. No-ad game scoring does not affect the recorded game totals. Lines carry one of the five results the TennisLink form offers: completed, timed, retired, default, double default. A timed line keeps the games as played, must not already be decided, and takes its winner from total games (the reviewer names the winner on equal games). Retired and default lines need a reviewer-named winner; a default may carry no scores; a double default carries neither scores nor a winner. Walkovers, special eligibility constraints and point-level set tiebreak details are not implemented and are rejected rather than coerced.

## Persistence, recovery and duplicate protection

`Store` uses Node's built-in SQLite with WAL, foreign keys, immediate transactions, optimistic revisions, immutable content-addressed artifacts and append-only events. State and audit events commit together. `getJob()` plus `history()` reconstruct the last durable checkpoint after restart. State-machine transitions alone are not proof of stage correctness; a future runner must parse and validate every stage's artifacts before checkpointing.

- Approval binds the exact persisted `VALIDATED` artifact to a named human reviewer and unique approval ID.
- Population and submission recheck official context against the approved snapshot. Both reject reported/unknown results. Submission reads back all payload fields again immediately before the external write.
- The submission table has a unique **match ID**, so both identical retries and altered-score retries are blocked across jobs sharing the database. The fingerprint excludes approval timestamps and reviewer identity.
- The reservation and `SUBMITTING` checkpoint commit before any external submit call. Never retry `SUBMITTING` automatically after a crash. A thrown error records `SUBMISSION_UNKNOWN` and retains the reservation.
- Reconcile uncertain outcomes manually against TennisLink. `completeSubmission` can record a verified official receipt for an uncertain/in-flight submission; no automatic reservation release is supplied. A confirmed non-submission requires an explicit future recovery workflow.
- Interrupted population must be reviewed and moved to `NEEDS_REVIEW`, then revalidated and reapproved. `FAILED` jobs are terminal; create a replacement job and preserve the original job ID in its evidence.

The external website cannot participate in the SQLite transaction. This prevents automatic duplicate attempts by cooperating workers on one database, not exactly-once delivery across unrelated database copies or independent human sessions. Use one shared local database per academy deployment; distributed deployments need a central transactional store. There remains a race if someone else edits TennisLink between the last check and the click.

## Submission gate

`ENABLE_FINAL_SUBMISSION` defaults to `false`; only the literal `true` enables configuration. A future runner must pass `loadConfig().finalSubmissionEnabled` to `submitMatch`, plus the exact `confirmedApprovalId` supplied through an authenticated human confirmation flow. The flag alone is insufficient: a persisted approval, verified population, unchanged context, fresh read-back, and unique reservation are all required. No live write port exists yet, so setting the flag cannot submit to TennisLink in this scaffold.

## Privacy and operations

Keep original images, private rosters, artifacts, session profiles, environment files and databases under ignored `var/` or secure external storage. Audit APIs accept structured evidence only; never log credentials, cookies or model API keys. Application append-only triggers protect against accidental edits, not an administrator rewriting the database. Use OS access controls, encryption at rest/backups, and a retention policy for minors' information before production. Image adapter contracts include hashes; durable binary storage and retention are not implemented yet.

## Project map

- `src/domain/`: strict schemas, state transitions, canonical hashing.
- `src/tennis/`: configurable deterministic score validation.
- `src/tennislink/`: Playwright readers and guarded write service contracts.
- `src/storage/`: SQLite jobs, evidence, approvals and submission reservations.
- `src/pipeline/ports.ts`: preprocessing and two-pass AI boundaries.
- `src/cli/capture-context.ts`: supervised read-only capture command.
- `tests/`: domain, recovery, submission guards and browser fixture tests.

Reference documentation used for the scaffold: [Playwright locators](https://playwright.dev/docs/locators), [Playwright auto-waiting](https://playwright.dev/docs/actionability), [Zod schemas](https://zod.dev/api).

## Verification in the initial workspace

Typechecking, build, and the non-browser tests were run locally. The Chromium fixture test was attempted after browser installation, but the macOS execution sandbox denied Chromium Mach-port access before the test loaded. It remains enabled in `pnpm check` and CI; it has not been verified passing here.

Chromium was installed locally under ignored `var/playwright`. To reuse it in a terminal that allows browser launch, run `PLAYWRIGHT_BROWSERS_PATH=var/playwright pnpm test:browser`. Otherwise, use the standard `pnpm exec playwright install chromium` setup above.

## Local digital scorecard dry run

The read-only parser supports the supplied digital scorecard layout. It does not OCR handwriting or call a vision API. Install `pypdf`, `pypdfium2` and `pillow` in your Python environment (`python3 -m venv .venv && .venv/bin/pip install pypdf pypdfium2 pillow`), then run:

```sh
python scripts/extract-digital-scorecards.py /path/to/scorecards.pdf var/pdf-extraction
pnpm dry-run var/pdf-extraction/observations.json var/dry-run-unique-name
```

Use a new output directory for each run. Review rendered pages against the extracted observations before relying on them. The command verifies PDF/render hashes, validates discovery and observed-data schemas, compares printed totals to line sums, and records each match at `NEEDS_REVIEW` in SQLite. It never calls TennisLink or promotes observed totals into completed sets, validated results, or approvals. Official context and scoring rules are prerequisites for the full tennis validator.

## Academy score reader and local credentials

A private, git-ignored `.env` file has been created with blank `USTA_USERNAME` and `USTA_PASSWORD` fields. Fill these locally; quote values containing `#` or spaces. Never include the `.env` file or browser profile in shared archives. Secrets are read separately from ordinary configuration and are not included in score snapshots.

`ACADEMY_NAME` defaults to `Momentum Tennis`. `ACADEMY_ALIASES` accepts comma-separated name aliases. Name matching uses case-insensitive whole-token phrases, including team suffixes such as `12U Green B`. For precise membership, set comma-separated `ACADEMY_TEAM_IDS`; when present, only those IDs match, and the configured row selectors must expose official team IDs. Both home and away teams are checked.

To read scores:

1. Set `TENNISLINK_SCORES_URL` to an actual authorized schedule/results listing containing your teams. No production listing URL is guessed.
2. Copy `config/score-selectors.example.json` to `config/score-selectors.local.json` and calibrate selectors against that page. Selectors within a row are relative to that row. Select score display text, not hidden inputs. Set optional unavailable fields to `null`.
3. Run `pnpm scores`. Sign in manually and complete any MFA/CAPTCHA. The command reloads the configured listing and saves a private JSON snapshot under `var/scores/`.
4. Optionally copy `config/login-selectors.example.json` to `config/login-selectors.local.json`, set its exact verified USTA HTTPS login origin and input selectors, then set `TENNISLINK_LOGIN_SELECTORS` to that file. The command can fill the credentials on that exact origin; you still click Sign In and complete any challenge. Leave this setting blank for manual login or third-party identity providers.

`readCurrentScores` reads displayed match IDs, team names/IDs, date, status and score strings. Blank scores remain `null`; a displayed zero remains `"0"`. It does not assume whether scores represent games, sets or team wins, and its snapshots cannot be used as approved score-entry payloads.

`readAcademyScores` filters both sides and follows only explicitly configured same-host navigation links. The default page limit is 10; configure `TENNISLINK_MAX_SCORE_PAGES` (1–100). Reports identify the number of pages and rows read, whether pagination was configured, and whether traversal stopped at the limit. The scope is the configured listing, **not all academy matches across TennisLink**. ASP.NET JavaScript/postback pagination is not implemented; use a supported listing or add a verified navigation adapter. Detail URLs are collected but not followed. Per-line player/set detail capture is not implemented in this reader.

Selectors and live login have not been verified against TennisLink. Unit tests cover filtering, blank/zero scores, paging limits, empty states, runtime environment precedence, and secret exclusion. Browser integration remains subject to the previously documented macOS sandbox restriction.

Implementation references: [Node.js environment files](https://nodejs.org/api/environment_variables.html), [Playwright locator API](https://playwright.dev/docs/api/class-locator).

## Web app: upload, reconcile, approve (fall 2026)

`pnpm serve` runs the reviewer app on `127.0.0.1:$WEB_PORT`. Reviewers sign in with a token from `config/reviewers.local.json`; every approval carries the reviewer's name. The PDF parser runs as `PYTHON_BIN scripts/extract-digital-scorecards.py` per upload, so the venv from the setup step must exist.

Flow per match: upload the digital scorecard PDF (one job per card, each with an 8-character match code valid 24 hours) → the coach opens the match's Score Card page on TennisLink, taps the bookmark (page `/bookmarklet`) and enters the code; the script sends the form's rosters, lines, format labels and result options back → the reviewer resolves names against the official roster, sets each line's result (Completed, Timed Match, Retired, Default, Dbl Default) and validates → approves → the coach taps the bookmark again; the script fills the form from the approved result, reads every field back and reports the difference; on a match the job reserves the submission → the coach presses Next, then Finish, then taps the bookmark once more on the page that follows, which records the receipt.

The app never holds a TennisLink session: capture, fill and receipt run in the coach's own browser, and the only credential the bookmarklet carries is the match code. `/api/*` answers CORS for `https://tennislink.usta.com` only. A read-back that differs sends the job back to review; nothing is submitted by the app.

`config/format-rules.local.json` maps the form's format label (`Short Set (4 Games)`) to a rule id in `config/scoring-rules.local.json`; an unmapped label refuses the capture. Sides printed the wrong way round are swapped on the job page before validation.

Reachability: bind stays loopback; publish with a `cloudflared` tunnel to an https hostname and set `WEB_PUBLIC_URL` to it (the bookmarklet loads `/fill.js` from there).

## Measurement (fall 2026)

Four numbers per match, all derived from the audit events, none entered by hand:

- errors caught, by category, tallied at approval (`ERRORS_CAUGHT`): roster mismatch, result not Completed, winner-first reorder, totals mismatch, score edited;
- minutes from upload (`RECEIVED`) to approval (`APPROVED`);
- minutes from the fill plan being served to the coach's browser (`FILL_PLAN_SERVED`) to the verified read-back (`POPULATION_VERIFIED`);
- matches processed (`SUBMITTED`).

Baseline: before the bookmarklet is used for entry, time at least three matches entered by hand, from opening the scorecard to pressing Finish, and record each on the report page. The comparison is baseline minutes against upload→approval plus fill→read-back.

`pnpm report` prints the season table; the same table is at `/report` in the web app.
