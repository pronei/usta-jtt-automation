# Open items

Decisions and deferrals recorded on 2026-10-11. Each line says what is open and what was decided about it.

- **Reviewer tokens.** `config/reviewers.local.json` holds a throwaway token from the first local check. Replace it with one token per real reviewer before coaches use the app. Deferred by the operator.
- **Stuck at SUBMITTING.** A job whose coach never pressed Finish, or never tapped the bookmark afterwards, only moves when a reviewer marks the outcome unknown. Planned fix: a `verify` stage for the bookmarklet, taken on the match's Score Card page at any later time, which captures the form as entered and lets the server either complete the submission (scores present and equal to the approved result) or release the reservation (form still blank). The store has no reservation release yet; that is the first piece.
- **Rate limiting.** `/login` and `/api/handshake` have none. Tokens are 16+ characters and codes 8 symbols from a 32-symbol alphabet, so guessing is not realistic. Put Cloudflare Access in front of the pages (not `/api/*` or `/fill.js`) once the tunnel exists. Deferred.
- **Backup and retention.** `var/momentum.sqlite` and `var/uploads/` hold minors' names and are not backed up; no retention period is set. To be planned: a nightly copy of the database to encrypted storage, deletion of uploads after the season, and a written retention period. Deferred.
- **Timings.** The capture tap is not timed, and fill time starts when the plan is served, so coach time between taps is not measured. Accepted for this season.
- **USTA Connect.** Written reply received: a partnership program for established vendors (typically 8,000–10,000 users, a public product); APIs limited to WTN/NTRP ratings, SafePlay, the facility database and USTA SSO/account creation. No match history, rankings or schedules. No JTT entry API. The coach's own sign-in stays; the bookmarklet does the entry.
