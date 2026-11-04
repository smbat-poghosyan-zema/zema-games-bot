import { Bot, type Context } from 'grammy';
import type { Config } from './config.js';
import { gamesListMessage, toPlayer } from './format.js';
import { PLAY_CALLBACK, type FlowApi, type GameFlow } from './flow.js';
import type { Game } from './games.js';
import { texts } from './texts.js';

/** Update types the bot needs; also passed to getUpdates/setWebhook. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'poll', 'poll_answer'] as const;

/** Creates the bot and its game flow (the flow sends messages through the bot's API). */
export function createBot(
  config: Config,
  games: readonly Game[],
  makeFlow: (api: FlowApi) => GameFlow,
): { bot: Bot; flow: GameFlow } {
  const bot = new Bot(config.token);
  const flow = makeFlow(bot.api);

  const isGroup = (ctx: Context) => ctx.chat?.id === config.chatId;
  const isPrivate = (ctx: Context) => ctx.chat?.type === 'private';

  // Only the Zema Games group and private chats get through. poll / poll_answer updates
  // carry no chat; the flow ignores polls that don't belong to the active session.
  bot.use(async (ctx, next) => {
    if (!ctx.chat || isGroup(ctx) || isPrivate(ctx)) await next();
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
    await flow.start(toPlayer(ctx.from));
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

  bot.on('poll_answer', (ctx) => flow.onPollAnswer(ctx.pollAnswer));
  bot.on('poll', (ctx) => flow.onPoll(ctx.poll));

  bot.catch((err) => {
    const e = err.error as Error | undefined;
    console.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, e?.message ?? e);
  });

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
