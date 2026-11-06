# Zema Games bot

Telegram bot ([@zemagames_bot](https://t.me/zemagames_bot)) that organizes office game sessions in the
**Zema Games** supergroup. Someone types `/play` and ticks the games they'd like to play, the bot runs a
"who's in?" poll, picks the ticked game that fits the number of players (with a second poll when several
fit) and tags the team. Several people can collect players at the same time. On weekdays after
lunch it posts a reminder with a button that starts `/play`.

All bot texts are Armenian and live in [`src/texts.ts`](src/texts.ts).

## How a session works

1. `/play` in the group (or the **🎲 Սկսել խաղը** button under the daily reminder) posts a game picker:
   one checkbox button per game, plus **✔️ Պատրաստ է** (done) and **🗑 Ջնջել** (delete). Only the
   starter can tick games. An unfinished picker is dropped after 5 minutes.
2. After Done, the bot posts a native, non-anonymous poll that names the starter and the ticked games
   and closes after 10 minutes. Ticking a single game works like `/play <game>` (below).
   Under the poll, **▶️ Սկսել հիմա** (start now) closes it early once at least 2 people joined; only
   the starter can press it. **🗑 Ջնջել** deletes the poll; the starter or a group admin can press it.
3. When Telegram closes the poll, only the ticked games count:
   - fewer than 2 players: the session ends;
   - exactly one ticked game fits the player count: it's announced right away;
   - two or more fit: a second poll with those games runs for 5 minutes. Only votes from players who
     joined are counted; on a tie the bot picks randomly among the tied games and says so;
   - too many players for every ticked game: the bot splits everyone into random groups and lists the
     ticked games that fit each group size;
   - none fits otherwise (e.g. too few for all of them): the bot lists other games from the catalog
     that fit, if any.
4. The final message names the game (plus the link for online games) and mentions every player
   (`@username`, or a text mention when the user has no username).

**Parallel sessions.** Anyone can open a session while others are running, but each person can have
only one open at a time. Running `/play` again asks whether to delete the open one and start a new one
(**🗑 Ջնջել և բացել նորը** / **Թողնել**); nothing is deleted without that confirmation. A player may
join several polls. The daily reminder is skipped while any session is open.

Commands: `/play`, `/play <game>`, `/games`, `/cancel` (deletes your own open session), `/help`.

`/play <game>` (e.g. `/play Azul`, `/play kittens`; case-insensitive, partial names work) skips the
picker and the vote. When the poll closes: fewer than the game's minimum ends the session, within its
range announces the team, more than its maximum splits everyone into groups for that game. The start
now button then needs the game's minimum instead of 2.
In private chats only `/help`, `/start` and `/games` work. Other groups are ignored.

### Why it survives restarts

The flow is driven by Telegram updates, not by in-memory timers:

- `poll_answer` updates track who joined and who voted (bots get these for non-anonymous polls they sent).
- A `poll` update with `is_closed: true` arrives when `open_period` ends (bots get `poll` updates for
  polls they sent). That is what moves the session to the next step.
- `allowed_updates` is set to `message`, `callback_query`, `poll`, `poll_answer`.
- Telegram keeps undelivered updates for up to 24 hours, so a poll that closes while the bot is down is
  processed when it comes back.
- Open sessions are saved to a JSON file (`DATA_FILE`) after every change (on a host with a
  persistent disk; Render's free disk is wiped on restart, see [Hosting](#hosting)).
- As a safety net, if no close update arrives 15 seconds after the expected close time, the bot stops
  the poll itself and finishes the step.

## Setup

Requirements: Node.js 24 LTS (`nvm use`), npm.

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # long polling, restarts on file changes
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run lint` | ESLint + type check |
| `npm test` | Unit tests (Vitest) |

> Use a **separate test bot** (create one with @BotFather) for local development once production is
> running. Starting the bot in polling mode deletes the webhook, so running `npm run dev` with the
> production token takes updates away from the production instance until it restarts.

### Group setup

Add the bot to the group **as an admin** (no special rights are needed). Bots in privacy mode only see
`/play` in a group if they were the last bot to post there or the command is written as
`/play@zemagames_bot`. Admin bots receive every message. Disabling privacy mode in @BotFather
(`/setprivacy`) also works.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | | Bot token from @BotFather. Never commit or log it. |
| `TELEGRAM_CHAT_ID` | yes | | ID of the Zema Games supergroup (`-100...`). The bot ignores other groups. |
| `BOT_MODE` | no | `polling` | `polling` (local dev) or `webhook` (production). |
| `WEBHOOK_URL` | webhook | `RENDER_EXTERNAL_URL` | Public HTTPS base URL, e.g. `https://bot.example.com`. Not needed on Render. |
| `WEBHOOK_SECRET` | webhook | | Random string (`A-Z a-z 0-9 _ -`). Telegram sends it in a header and the bot rejects requests without it. |
| `WEBHOOK_PATH` | no | `/telegram` | Path the webhook is served on. |
| `PORT` | no | `8080` | HTTP port in webhook mode (Render sets it). `GET /healthz` returns `ok`. |
| `DATA_FILE` | no | `data/state.json` | Where open sessions are stored. |
| `JOIN_POLL_SECONDS` | no | `600` | How long the "who's in?" poll stays open, in seconds (5-3600). |
| `GAME_POLL_SECONDS` | no | `300` | How long the game vote stays open, in seconds (5-3600). |
| `REMINDER_ENABLED` | no | `true` | Turn the daily reminder on or off. |
| `REMINDER_TIME` | no | `14:00` | Reminder time, 24h `HH:MM`. |
| `REMINDER_DAYS` | no | `MON-FRI` | Cron day-of-week field: `MON-FRI`, `1-5`, `MON,WED,FRI`, ... |
| `TIMEZONE` | no | `Asia/Yerevan` | Timezone for the reminder. |
| `CRON_SECRET` | no | | Enables `GET /cron/reminder` (webhook mode) for an external scheduler. Callers send `Authorization: Bearer <CRON_SECRET>`. At least 16 chars. |

## Editing the games

Games live in [`games.json`](games.json). Each entry:

```json
{
  "name": "Azul",
  "type": "physical",
  "minPlayers": 2,
  "maxPlayers": 4,
  "durationMinutes": 40,
  "description": "One line in Armenian",
  "link": "https://... (online games only)",
  "source": "Where the player counts and play time come from"
}
```

The file is validated on startup, so a typo stops the bot with a clear error instead of breaking a
session. After editing, run `npm test` and redeploy (see [Updating](#updating)).

### Sources for the current list

| Game | Players | Minutes | Source |
| --- | --- | --- | --- |
| Blokus | 2-4 | 20 | [Mattel](https://shop.mattel.com/products/blokus-game) (page was rate-limited when checked; 2-4 players and 15-30 min agree across retailer listings) |
| Azul | 2-4 | 40 (box: 30-45) | [Next Move Games](https://www.nextmove-games.com/en/azul/azul-game/) |
| Exploding Kittens | 2-10 | 15 | Max 10 is our house rule; the official box says 2-5: [Exploding Kittens](https://www.explodingkittens.com/products/exploding-kittens), [Asmodee UK](https://www.asmodee.co.uk/products/ekgorg1-exploding-kittens-original-edition) |
| Spot it | 2-8 | 15 | [Asmodee](https://store.asmodee.com/products/spot-it-classic-eco-sleeve-ml) |
| Gartic Phone | 4-30 | 15 | **Unverified.** garticphone.com publishes no player limits. 4 is a practical minimum for a fun chain; 30 is the commonly cited lobby cap. Check a lobby and adjust. |

## Changing the reminder

Set `REMINDER_TIME`, `REMINDER_DAYS` and (rarely) `TIMEZONE` in `.env` and restart the bot. Examples:

```bash
REMINDER_TIME=13:30
REMINDER_DAYS=MON,WED,FRI
```

Set `REMINDER_ENABLED=false` to turn it off. The reminder is skipped while a session is running and is
sent at most once per day, even across restarts. Its texts rotate randomly (never the same twice in a
row) and are in `texts.reminders` in [`src/texts.ts`](src/texts.ts).

## Hosting

We want it free, and some sleeping on idle is acceptable.

| Option | Sleep / cold start | Scheduled message | Verdict |
| --- | --- | --- | --- |
| **Render free web service** | Sleeps after 15 min without traffic, wakes in about 1 min | No free cron jobs; an external scheduler calls the bot | **Chosen** |
| Oracle Cloud Always Free VM | Never sleeps | In-process cron | Free capacity is often unavailable at sign-up, and idle VMs can be reclaimed |
| Cloudflare Workers (free) | Cold starts in ms | Cron Triggers | No Node process or disk; storage, scheduling and the fallback timer would need a rewrite |
| Fly.io / Railway | No sleep | Works | No free tier for new accounts |

**Why Render:** it deploys this repo as it is (Node runtime, webhook mode) with no server to manage, and
a free web service wakes up when Telegram sends a webhook, so no update is lost while it sleeps. A free
[Cloudflare Worker](worker/index.ts) with a cron trigger handles the rest: every 10 minutes during office
hours it calls `/cron/reminder`, which keeps the service awake (no cold start for `/play`) and sends the
reminder when it's due.

We used two [cron-job.org](https://cron-job.org) jobs before. From 2026-11-05 Render answered their
requests with `429 Too Many Requests` before they reached the bot, so the service stayed asleep and the
2026-11-06 reminder was never sent. Those jobs are kept disabled for rollback.

Render free limits to know:

- 750 free instance hours per workspace per month. Office-hours pinging (about 10 h × 22 days) uses
  around 220 h.
- The filesystem is not persistent: the session file is lost on every redeploy, restart or spin-down.
  With the office-hours pinger the service stays up during sessions. Redeploying while a session is
  running drops that session; just `/play` again.
- Build and deploy happen from a Git repository (GitHub, GitLab or Bitbucket).

### Deploy to Render

1. **Push the repo to GitHub** (a private repo is fine):
   ```bash
   git remote add origin git@github.com:<org>/zema-games-bot.git
   git push -u origin main
   ```
2. **Create the service from the Blueprint**: in the Render dashboard choose **New → Blueprint**,
   connect GitHub and pick the repo. Render reads [`render.yaml`](render.yaml): a free Node web
   service in Frankfurt with `npm ci && npm run build` and `npm start`, health check on `/healthz`.
3. **Fill in the secrets** Render asks for:
   - `TELEGRAM_BOT_TOKEN`: the production bot token.
   - `TELEGRAM_CHAT_ID`: `-1003795070488`.
   - `WEBHOOK_SECRET` and `CRON_SECRET`: generate each with `openssl rand -hex 32`.

   `WEBHOOK_URL` and `PORT` are not needed: the bot uses Render's `RENDER_EXTERNAL_URL` and `PORT`.
4. **Deploy and check the logs**. You should see `starting in webhook mode` and
   `webhook set, listening on :10000/telegram, /cron/reminder enabled`. Then open
   `https://<service>.onrender.com/healthz`; it should return `ok`.
5. **Deploy the Cloudflare cron Worker** (next section).
6. **Check it in Telegram**: `/help` in a private chat, then `/play` in the group.

### Cloudflare cron Worker

[`worker/`](worker) holds a tiny Worker whose cron trigger calls `GET /cron/reminder` with
`Authorization: Bearer <CRON_SECRET>` every 10 minutes, Monday to Friday, 09:00-18:50 Asia/Yerevan
(`*/10 5-14 * * MON-FRI` in UTC, see [`worker/wrangler.jsonc`](worker/wrangler.jsonc)). Cron Triggers
are included in the Workers free plan.

The endpoint only sends when the current time is within 30 minutes after the configured
`REMINDER_TIME`/`REMINDER_DAYS`, and at most once per day; otherwise it answers `not due`. The
in-process cron also fires at 14:00 because the service is awake; duplicates are prevented by the same
once-per-day check. If you move the reminder outside 09:00-18:50 or to other days, widen the Worker's
cron too.

One-time setup:

1. In the Cloudflare dashboard, open **My Profile → API Tokens → Create Token** and use the
   **Edit Cloudflare Workers** template. Under **Account Resources** pick your account; under **Zone
   Resources** choose **All zones**. Create it and copy the token.
2. Copy your **Account ID** (Workers & Pages overview, right column).
3. Put both in `.env` (never committed):
   ```
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   ```

Deploy, then store the secret (same value as the bot's `CRON_SECRET`):

```bash
set -a && . ./.env && set +a
npx wrangler@4 deploy -c worker/wrangler.jsonc
printf %s "$CRON_SECRET" | npx wrangler@4 secret put CRON_SECRET -c worker/wrangler.jsonc
```

Check runs under **Workers & Pages → zema-games-cron → Logs** (`[cron] /cron/reminder: not due`
or `sent`), or with `npx wrangler@4 tail -c worker/wrangler.jsonc`.

### Updating

Push to `main`; Render redeploys automatically. Changing `games.json` works the same way.

### Running it elsewhere

The [`Dockerfile`](Dockerfile) runs the same bot on any Docker host:

```bash
docker build -t zema-games-bot .
docker run -d --restart unless-stopped --env-file .env -v zema-games-data:/app/data zema-games-bot
```

That's long polling by default. On a host that is always on, the in-process reminder is enough and
the cron Worker is not needed.

## Project layout

```
src/
  index.ts     entry point: config, polling or webhook mode, reminder job
  server.ts    webhook HTTP server: /telegram, /healthz, /cron/reminder
  bot.ts       grammY handlers, chat filter, command menus
  flow.ts      session state machine (picker -> join poll -> game poll -> final message), many in parallel
  plan.ts      pure logic: game filtering, plan after join, tie-break, group split
  games.ts     games.json loading and validation
  schedule.ts  reminder cron (Asia/Yerevan)
  store.ts     JSON file store for open sessions
  format.ts    mentions, HTML escaping, games list
  texts.ts     every Armenian text
  log.ts       logging with bot-token redaction
games.json     the game list
worker/        Cloudflare cron Worker that wakes the service and triggers the reminder
render.yaml    Render Blueprint (free web service)
```
