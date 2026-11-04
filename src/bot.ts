import { Bot, type BotConfig, type Context } from 'grammy';
import type { Config } from './config.js';
import { escapeHtml, gamesListMessage, toPlayer } from './format.js';
import { PLAY_CALLBACK, START_NOW_CALLBACK, type FlowApi, type GameFlow } from './flow.js';
import { findGames, type Game } from './games.js';
import { log } from './log.js';
import { texts } from './texts.js';

/** Update types the bot needs; also passed to getUpdates/setWebhook. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'poll', 'poll_answer'] as const;

/** Creates the bot and its game flow (the flow sends messages through the bot's API). */
export function createBot(
  config: Config,
  games: readonly Game[],
  makeFlow: (api: FlowApi) => GameFlow,
  botConfig?: BotConfig<Context>,
): { bot: Bot; flow: GameFlow } {
  const bot = new Bot(config.token, botConfig);
  const flow = makeFlow(bot.api);

  const isGroup = (ctx: Context) => ctx.chat?.id === config.chatId;
  const isPrivate = (ctx: Context) => ctx.chat?.type === 'private';

  // Only the Zema Games group and private chats get through. poll / poll_answer updates
  // carry no chat; the flow ignores polls that don't belong to the active session.
  bot.use(async (ctx, next) => {
    const kind = Object.keys(ctx.update).find((k) => k !== 'update_id');
    const allowed = !ctx.chat || isGroup(ctx) || isPrivate(ctx);
    log.info(`[bot] ${kind}${ctx.chat ? ` from chat ${ctx.chat.id} (${ctx.chat.type})` : ''}${allowed ? '' : ' ignored'}`);
    if (allowed) await next();
  });

  const help = texts.help({
    joinMinutes: Math.round(config.joinPollSeconds / 60),
    reminderTime: config.reminder.time,
  });
  bot.command(['start', 'help'], (ctx) => ctx.reply(help, { parse_mode: 'HTML' }));
  bot.command('games', (ctx) =>
    ctx.reply(gamesListMessage(games), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  );

  bot.command('play', async (ctx) => {
    if (!isGroup(ctx)) return void (await ctx.reply(texts.playOnlyInGroup));
    if (!ctx.from) return;

    // "/play Azul" starts with that game and skips the vote.
    const query = ctx.match.trim();
    if (!query) return void (await flow.start(toPlayer(ctx.from)));
    const matches = findGames(games, query);
    if (matches.length === 1) return void (await flow.start(toPlayer(ctx.from), matches[0]));
    const names = (matches.length > 1 ? matches : games).map((g) => escapeHtml(g.name)).join(', ');
    await ctx.reply(matches.length > 1 ? texts.gameAmbiguous(names) : texts.gameNotFound(names), {
      parse_mode: 'HTML',
    });
  });

  bot.command('cancel', async (ctx) => {
    if (!isGroup(ctx)) return void (await ctx.reply(texts.cancelOnlyInGroup));
    if (!ctx.from) return;
    const result = await flow.cancel(toPlayer(ctx.from));
    if (result === 'none') await ctx.reply(texts.noActiveSession);
    if (result === 'forbidden') await ctx.reply(texts.cancelNotAllowed);
  });

  // Inline button under the daily reminder.
  bot.callbackQuery(PLAY_CALLBACK, async (ctx) => {
    if (!isGroup(ctx)) return void (await ctx.answerCallbackQuery());
    const result = await flow.start(toPlayer(ctx.from));
    await ctx.answerCallbackQuery({
      text: result === 'started' ? texts.callbackStarted : texts.callbackSessionActive,
    });
  });

  // "Start now" button under the join poll.
  bot.callbackQuery(START_NOW_CALLBACK, async (ctx) => {
    if (!isGroup(ctx)) return void (await ctx.answerCallbackQuery());
    const result = await flow.startNow(toPlayer(ctx.from));
    const reply = {
      started: { text: texts.startNowStarted },
      tooFew: { text: texts.startNowTooFew(flow.requiredPlayersNow()), show_alert: true },
      forbidden: { text: texts.startNowForbidden, show_alert: true },
      none: { text: texts.startNowClosed },
    }[result];
    await ctx.answerCallbackQuery(reply);
  });

  bot.on('poll_answer', (ctx) => flow.onPollAnswer(ctx.pollAnswer));
  bot.on('poll', (ctx) => flow.onPoll(ctx.poll));

  bot.catch((err) => log.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, err.error));

  return { bot, flow };
}

/** Command menus: everything in the group, help/games in private chats. */
export async function registerCommands(bot: Bot, chatId: number): Promise<void> {
  const c = texts.commands;
  await bot.api.setMyCommands(
    [
      { command: 'play', description: c.play },
      { command: 'games', description: c.games },
      { command: 'cancel', description: c.cancel },
      { command: 'help', description: c.help },
    ],
    { scope: { type: 'chat', chat_id: chatId } },
  );
  await bot.api.setMyCommands(
    [
      { command: 'games', description: c.games },
      { command: 'help', description: c.help },
    ],
    { scope: { type: 'all_private_chats' } },
  );
}
