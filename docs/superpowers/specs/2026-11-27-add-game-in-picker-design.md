# Add a game in the picker (one round only)

## Why

So people can bring their own games to the vote, not only the games in `games.json`.

## What

While a `/play` picker is open, its starter can add a game by name and player range. The game
is ticked in the picker, goes through the same headcount filter, vote and group split as the
built-in games, and is forgotten when the session ends. Nothing is saved beyond the session.

## Decisions (made together)

- **Scope:** for the current round only. No database, no change to `games.json`.
- **Fields:** name and player range only.
- **Who:** only the session starter, the same rule as ticking games today.
- **How:** a "+ Add game" button in the picker, with `/add <name> <range>` as a shortcut.

## Approaches considered

1. **Button, then a reply (picked).** The button makes the bot post a force-reply prompt
   (`selective`, so only the starter gets the reply box); the starter answers with
   `Codenames 4-8`. It fits the button-driven flow and works with group privacy mode, because
   replies to the bot always reach it.
2. **`/add` command only.** Least code, but hard to discover and clumsy on a phone. Kept as a
   shortcut on top of 1, since it shares the parser.
3. **Telegram Mini App form.** The nicest form, but it needs an HTTPS page, initData checks and
   group restrictions. Too much for two fields.

## Behaviour

- **Button:** a "+ Add game" row in the picker keyboard (`add:<sid>`). Someone other than the
  starter gets the existing "only the starter" alert. The starter gets a force-reply prompt
  replying to the picker, with an example of the format. One open prompt per session: a second tap
  reuses it.
- **Reply:** a message in the group that replies to the session's prompt and comes from the
  starter is parsed. Replies from others are ignored.
- **`/add <text>`:** the same parsing, for the sender's own session while it's in the picker stage.
  Without an open picker it answers with a short "open /play first" message. Without text, it acts
  like the button.
- **Format:** `<name> <min>-<max>` or `<name> <n>` (exact count). The name is the text before the
  last token, trimmed, at most 40 characters. The range is integers with 1 <= min <= max <= 50.
  A hyphen or en dash both work. Anything else gets a short reply with an example, and the prompt
  stays open.
- **Same name as a built-in game** (same normalisation as `findGames`, exact match): tick that
  game instead of adding a copy. The same check applies to games already added in this session.
- **On success:** the game is appended to the session's added games and ticked, the picker
  keyboard is redrawn, and the prompt and the reply are deleted (best effort).
- **Limit:** at most 4 added games per session. The 5th attempt gets a short "limit reached" reply.
- **After Done** the prompt is deleted if still open. Replies to it then match no picking session
  and are ignored.

## Data

- `Session.addedGames?: AddedGame[]`, where `AddedGame = { name, minPlayers, maxPlayers }`.
  (My call:) the session flow only uses name, player range and an optional link. Duration, type
  and description appear only in `/games`, which lists the catalog. So `plan.ts`,
  `gamesForPlayers` and the flow take a narrow structural type (`name`, `minPlayers`,
  `maxPlayers`, optional `link`) that both `Game` and `AddedGame` satisfy. No fake duration or
  description is stored.
- `PickerStage.promptMessageId?: number`: the open force-reply prompt.
- The `State` version stays 2: both fields are optional, so stored sessions still load.

## Code touch points

- `flow.ts`: the game lookup (`findGame`, the picker keyboard, `togglePick` order, `finishJoin`
  pool, `finishVote` winner) must use `[...this.games, ...session.addedGames]` for that session.
  The picker callback index then covers catalog plus added games. New methods: `askAddGame`,
  `addGame`.
- `bot.ts`: an `add:` callback, an `/add` command, and a `message` handler for replies to a prompt.
  Register `/add` in the group command list.
- `texts.ts`: the button label, prompt, format error, limit reached and "no open picker" texts,
  in Armenian like the rest.
- A parser function (in `games.ts` or a new small module) with unit tests.

## Non-goals

- Saving added games for later rounds, editing or removing them after adding, adding during the
  join poll or vote, and adding games through `/play <name>`.

## Left to the builder

- The exact Armenian wording. Keep the tone of the existing texts.
