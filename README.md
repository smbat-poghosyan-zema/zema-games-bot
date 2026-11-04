# Zema Games bot

Telegram bot ([@zemagames_bot](https://t.me/zemagames_bot)) that organizes office game sessions in the
**Zema Games** supergroup. Someone types `/play`, the bot runs a "who's in?" poll, picks a game that
fits the number of players (with a second poll when several fit) and tags the team. On weekdays after
lunch it posts a reminder with a button that starts `/play`.

All bot texts are Armenian and live in [`src/texts.ts`](src/texts.ts).

## How a session works

1. `/play` in the group (or the **🎲 Սկսել խաղը** button under the daily reminder) posts a native,
   non-anonymous poll that closes after 10 minutes. Only one session can run at a time.
   Once at least 2 people joined, the **▶️ Սկսել հիմա** (start now) button under the poll closes it
   early. Joined players, the starter and group admins can press it.
2. When Telegram closes the poll:
   - fewer than 2 players: the session is cancelled;
   - exactly one game fits the player count: it's announced right away;
   - two or more fit: a second poll with those games runs for 5 minutes. Only votes from players who
     joined are counted; on a tie the bot picks randomly among the tied games and says so;
   - nobody fits because there are too many players: the bot splits everyone into random groups and
     lists the games that fit each group size.
3. The final message names the game (plus the link for online games) and mentions every player
   (`@username`, or a text mention when the user has no username).

Commands: `/play`, `/play <game>`, `/games`, `/cancel` (session starter or a group admin), `/help`.

`/play <game>` (e.g. `/play Azul`, `/play kittens`; case-insensitive, partial names work) starts a
session for that game and skips the vote. When the poll closes: fewer than the game's minimum cancels,
within its range announces the team, more than its maximum splits everyone into groups for that game.
The start now button then needs the game's minimum instead of 2.
In private chats only `/help`, `/start` and `/games` work. Other groups are ignored.

### Why it survives restarts

The flow is driven by Telegram updates, not by in-memory timers:

- `poll_answer` updates track who joined and who voted (bots get these for non-anonymous polls they sent).
- A `poll` update with `is_closed: true` arrives when `open_period` ends (bots get `poll` updates for
  polls they sent). That is what moves the session to the next step.
- `allowed_updates` is set to `message`, `callback_query`, `poll`, `poll_answer`.
- Telegram keeps undelivered updates for up to 24 hours, so a poll that closes while the bot is down is
  processed when it comes back.
- The active session is saved to a JSON file (`DATA_FILE`) after every change (on a host with a
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
| `DATA_FILE` | no | `data/state.json` | Where the active session is stored. |
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
a free web service wakes up when Telegram sends a webhook, so no update is lost while it sleeps. Two
free [cron-job.org](https://cron-job.org) jobs handle the rest. One pings `/healthz` during office hours
so `/play` gets no cold start; the other triggers the 14:00 reminder even if the service is asleep.

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
5. **Create two cron-job.org jobs** (free account), both with timezone **Asia/Yerevan**:
   - **Keep warm**: `GET https://<service>.onrender.com/healthz`, every 10 minutes, Monday to Friday,
     09:00-19:00.
   - **Daily reminder**: `GET https://<service>.onrender.com/cron/reminder` with header
     `Authorization: Bearer <CRON_SECRET>`, Monday to Friday at 14:00 and again at 14:10. The second
     call is a retry in case the first one timed out during a cold start.

   The endpoint only sends when the current time is within 30 minutes after the configured
   `REMINDER_TIME`/`REMINDER_DAYS`, and at most once per day. If you change the reminder time in
   Render, move the cron-job.org schedule too. The in-process cron also fires when the service is
   awake at 14:00; duplicates are prevented by the same once-per-day check.
6. **Check it in Telegram**: `/help` in a private chat, then `/play` in the group.

### Updating

Push to `main`; Render redeploys automatically. Changing `games.json` works the same way.

### Running it elsewhere

The [`Dockerfile`](Dockerfile) runs the same bot on any Docker host:

```bash
docker build -t zema-games-bot .
docker run -d --restart unless-stopped --env-file .env -v zema-games-data:/app/data zema-games-bot
```

That's long polling by default. On a host that is always on, the in-process reminder is enough and
no cron-job.org jobs are needed.

## Project layout

```
src/
  index.ts     entry point: config, polling or webhook mode, reminder job
  server.ts    webhook HTTP server: /telegram, /healthz, /cron/reminder
  bot.ts       grammY handlers, chat filter, command menus
  flow.ts      session state machine (join poll -> game poll -> final message)
  plan.ts      pure logic: game filtering, plan after join, tie-break, group split
  games.ts     games.json loading and validation
  schedule.ts  reminder cron (Asia/Yerevan)
  store.ts     JSON file store for the active session
  format.ts    mentions, HTML escaping, games list
  texts.ts     every Armenian text
  log.ts       logging with bot-token redaction
games.json     the game list
render.yaml    Render Blueprint (free web service)
```
