# Dry run on a real match

Capture, reconcile, approve, fill and read back on a real match that TennisLink shows no scores for, and stop before submitting. You sign in to TennisLink yourself, in your own browser. Your USTA username and password never go into this app, `.env` or a terminal; leave `USTA_USERNAME` and `USTA_PASSWORD` in `.env` blank (they belong to the old operator CLI).

## Before

- A match with no scores on TennisLink, on which your USTA account is a captain or coach of one of the teams.
- Its scorecard: the digital PDF, or the JSON export of a finalised card from the platform's `/coach/scorecards`.
- Desktop Chrome for the first run: the bookmark installs by dragging.

## Steps

1. Terminal 1, a temporary https address for the app (no Cloudflare account needed; a new address each run):
   ```
   cloudflared tunnel --url http://127.0.0.1:8787
   ```
   Copy the `https://….trycloudflare.com` address it prints.
2. Terminal 2, the app on a separate database. A matching read-back takes the match's submission reservation, and a dry run must not hold the real one:
   ```
   WEB_PUBLIC_URL=https://….trycloudflare.com DATABASE_PATH=var/dry-run.sqlite pnpm serve
   ```
3. In Chrome, open the trycloudflare address and sign in with the reviewer token in `config/reviewers.local.json`. On the Bookmark page, drag the Score entry link to the bookmarks bar. Reinstall it on every run: it carries the tunnel address.
4. Upload the scorecard. The match appears at `MATCH_DISCOVERED` with a code.
5. Capture. In a new tab, open the TennisLink match entry page (`https://tennislink.usta.com/TeamTennis/Secure/EnterMatchNumber.aspx`), sign in, open the match entry page again, type the match number and continue to the Score Card. Tap the bookmark and enter the code. Expect "Captured". If it says TennisLink already shows scores, choose another match.
6. Reconcile in the app: check each name against the official roster, each result and winner; Validate; Approve.
7. Fill. On the Score Card tab (if it has sat a while, go through the match entry page again), tap the bookmark. Expect every field filled and "Every field matches the approved result". Compare the form with the scorecard.
8. Stop. Do not press Next. Press Cancel or close the tab: nothing is saved until Next and Finish. Do not tap the bookmark again on that form; it would record a receipt in the dry-run database.
9. Ctrl-C both terminals. `DATABASE_PATH=var/dry-run.sqlite pnpm report` shows the timings. Then delete `var/dry-run.sqlite`.

## Record

In `tennislink-automation/outputs/first-bookmarklet-dry-run.md`, with no player names:
- every message the bookmark showed, verbatim, especially any starting "Stopped:";
- whether the fill was refused because a select posts back;
- the Score Card address after typing the match number;
- the id of the match-number box on the match entry page (right-click it, Inspect), so a later version can type the number in;
- the minutes each step took.

## If something fails

- No overlay at all: open `https://….trycloudflare.com/fill.js` in that tab to check the tunnel, and check the bookmark was reinstalled for this run's address.
- "Stopped: Failed to fetch": open the browser console (View, Developer, JavaScript Console) and look for a Content-Security-Policy refusal on TennisLink's page.
- "Unknown or expired code": codes last 24 hours; press New code on the match page.
- "Unrecognised line label" or "Form control missing": the live page differs from the 13 Sept capture. Stop and save the message.

What the page after Finish looks like is answered only by the first real submission (plan 3, Task 4), not by this dry run.
