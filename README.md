# Zema Games bot

Telegram bot ([@zemagames_bot](https://t.me/zemagames_bot)) that organizes office game sessions in the
**Zema Games** supergroup. Someone types `/play`, the bot runs a "who's in?" poll, picks a game that
fits the number of players (with a second poll when several fit) and tags the team. On weekdays after
lunch it posts a reminder with a button that starts `/play`.

All bot texts are Armenian and live in [`src/texts.ts`](src/texts.ts).

## How a session works

1. `/play` in the group (or the **🎲 Սկսել խաղը** button under the daily reminder) posts a native,
   non-anonymous poll that closes after 5 minutes. Only one session can run at a time.
2. When Telegram closes the poll:
   - fewer than 2 players: the session is cancelled;
   - exactly one game fits the player count: it's announced right away;
   - two or more fit: a second poll with those games runs for 2 minutes. Only votes from players who
     joined are counted; on a tie the bot picks randomly among the tied games and says so;
   - nobody fits because there are too many players: the bot splits everyone into random groups and
     lists the games that fit each group size.
3. The final message names the game (plus the link for online games) and mentions every player
   (`@username`, or a text mention when the user has no username).

Commands: `/play`, `/games`, `/cancel` (session starter or a group admin), `/help`.
In private chats only `/help`, `/start` and `/games` work. Other groups are ignored.

### Why it survives restarts

The flow is driven by Telegram updates, not by in-memory timers:

- `poll_answer` updates track who joined and who voted (bots get these for non-anonymous polls they sent).
- A `poll` update with `is_closed: true` arrives when `open_period` ends (bots get `poll` updates for
  polls they sent). That is what moves the session to the next step.
- `allowed_updates` is set to `message`, `callback_query`, `poll`, `poll_answer`.
- Telegram keeps undelivered updates for up to 24 hours, so a poll that closes while the bot is down is
  processed when it comes back.
- The active session is saved to a JSON file (`DATA_FILE`) after every change.
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
| `WEBHOOK_URL` | webhook | | Public HTTPS base URL, e.g. `https://bot.example.com`. |
| `WEBHOOK_SECRET` | webhook | | Random string (`A-Z a-z 0-9 _ -`). Telegram sends it in a header and the bot rejects requests without it. |
| `WEBHOOK_PATH` | no | `/telegram` | Path the webhook is served on. |
| `PORT` | no | `8080` | HTTP port in webhook mode. `GET /healthz` returns `ok`. |
| `DATA_FILE` | no | `data/state.json` | Where the active session is stored. |
| `JOIN_POLL_SECONDS` | no | `300` | How long the "who's in?" poll stays open (5-600). |
| `GAME_POLL_SECONDS` | no | `120` | How long the game vote stays open (5-600). |
| `REMINDER_ENABLED` | no | `true` | Turn the daily reminder on or off. |
| `REMINDER_TIME` | no | `14:00` | Reminder time, 24h `HH:MM`. |
| `REMINDER_DAYS` | no | `MON-FRI` | Cron day-of-week field: `MON-FRI`, `1-5`, `MON,WED,FRI`, ... |
| `TIMEZONE` | no | `Asia/Yerevan` | Timezone for the reminder. |
| `DOMAIN` | deploy | | Hostname Caddy serves HTTPS on (Docker Compose deploy only). |

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
| Exploding Kittens | 2-5 | 15 | [Exploding Kittens](https://www.explodingkittens.com/products/exploding-kittens), [Asmodee UK](https://www.asmodee.co.uk/products/ekgorg1-exploding-kittens-original-edition) |
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

We need an always-on bot with a daily scheduled message and a little persistent state, for free.

| Option | Sleep / cold start | Scheduled message | State | Verdict |
| --- | --- | --- | --- | --- |
| **Oracle Cloud Always Free VM** | Never sleeps | In-process cron works as-is | Real disk | **Chosen** |
| Cloudflare Workers (free) | Cold starts in ms | Cron Triggers | No disk; needs KV/D1/Durable Objects | Would need a rewrite of storage, scheduling and the fallback timer |
| Render free web service | Sleeps after 15 min idle, ~1 min wake-up | No free cron; needs an external pinger such as cron-job.org | Disk is wiped on every restart/deploy | Flaky reminder and lost sessions |
| Fly.io | No sleep | Works | Volumes | No free tier for new accounts (pay as you go) |

**Why Oracle:** the Always Free VM is the only option that is free and behaves like a normal server.
It never sleeps, so the 14:00 reminder fires on time, and the session file stays on disk across
restarts. The bot runs unchanged in Docker. The catches are a card check at sign-up and Oracle's
idle-reclaim policy (see the note in step 1).

### Deploy to Oracle Cloud (Docker Compose, webhook + Caddy HTTPS)

The production stack is [`deploy/docker-compose.yml`](deploy/docker-compose.yml): the bot in webhook
mode behind [Caddy](https://caddyserver.com/), which gets a Let's Encrypt certificate automatically.
Caddy only forwards `/telegram`.

1. **Create the account and VM**
   - Sign up at <https://www.oracle.com/cloud/free/> (needs a card for verification; Always Free
     resources are not charged). Pick a home region close to Armenia, e.g. Frankfurt.
   - Compute → Instances → Create instance: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex**
     (1 OCPU / 6 GB is plenty) or **VM.Standard.E2.1.Micro**. Add your SSH public key.
     If A1 shows "out of capacity", try another availability domain or the E2 Micro shape.
   - Oracle can reclaim Always Free VMs that stay almost idle for 7 days, and this bot is almost
     idle. Upgrading the account to **Pay As You Go** stops reclamation and Always Free resources stay
     free. Optionally set a budget alert.
2. **Open ports 80 and 443**
   - In the VM's subnet → Security List, add ingress rules for TCP 80 and 443 from `0.0.0.0/0`.
   - Oracle's Ubuntu images also block ports in iptables. On the VM:
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
3. **Install Docker** on the VM:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
4. **Copy the code** from your machine (the repo has no remote):
   ```bash
   rsync -av --exclude node_modules --exclude dist --exclude data --exclude .env ./ ubuntu@<VM_IP>:~/zema-games/
   ```
5. **Create `.env` on the VM** (`~/zema-games/.env`):
   ```bash
   TELEGRAM_BOT_TOKEN=<token>
   TELEGRAM_CHAT_ID=-1003795070488
   WEBHOOK_SECRET=<output of: openssl rand -hex 32>
   DOMAIN=<VM_IP with dots replaced by dashes>.sslip.io
   ```
   [sslip.io](https://sslip.io) resolves `129-151-10-20.sslip.io` to `129.151.10.20`, so no domain
   purchase is needed. If you have a domain, point an A record at the VM and use it instead.
   `chmod 600 .env`.
6. **Start it**:
   ```bash
   cd ~/zema-games
   docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
   docker compose --env-file .env -f deploy/docker-compose.yml logs -f bot
   ```
   You should see `starting in webhook mode` and `webhook set`. Check
   `https://<DOMAIN>/telegram` from a browser: it should return a 404 page with a valid certificate (the bot only accepts POST there).
7. **Check it in Telegram**: send `/help` to the bot in a private chat, then `/play` in the group.

The webhook is registered with `max_connections: 1` and the secret token, so updates are processed one
at a time and requests without the secret are rejected.

### Updating

```bash
rsync -av --exclude node_modules --exclude dist --exclude data --exclude .env ./ ubuntu@<VM_IP>:~/zema-games/
ssh ubuntu@<VM_IP> 'cd ~/zema-games && docker compose --env-file .env -f deploy/docker-compose.yml up -d --build'
```

The session file is in the `bot-data` Docker volume, so it survives rebuilds.

### Running with long polling instead

If you'd rather not open ports, polling works on the VM too:

```bash
docker build -t zema-games-bot .
docker run -d --name zema-games-bot --restart unless-stopped --env-file .env -e BOT_MODE=polling -v zema-games-data:/app/data zema-games-bot
```

## Project layout

```
src/
  index.ts     entry point: config, polling or webhook server, reminder job
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
deploy/        docker-compose.yml and Caddyfile for Oracle Cloud
```
