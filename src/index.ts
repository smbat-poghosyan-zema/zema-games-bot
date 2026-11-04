import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import { ALLOWED_UPDATES, createBot, registerCommands } from './bot.js';
import { loadConfig } from './config.js';
import { GameFlow } from './flow.js';
import { loadGames } from './games.js';
import { installProcessErrorHandlers, log } from './log.js';
import { createReminderJob } from './schedule.js';
import { JsonStore } from './store.js';

// Local dev convenience: read .env if present (production passes real env vars).
if (existsSync('.env')) process.loadEnvFile('.env');
installProcessErrorHandlers();

async function main(): Promise<void> {
  const config = loadConfig();
  const games = loadGames();
  const store = new JsonStore(config.dataFile);

  const { bot, flow } = createBot(
    config,
    games,
    (api) =>
      new GameFlow(api, store, games, {
        chatId: config.chatId,
        joinPollSeconds: config.joinPollSeconds,
        gamePollSeconds: config.gamePollSeconds,
        timezone: config.reminder.timezone,
      }),
  );
  flow.resume();

  await bot.init();
  log.info(`[bot] @${bot.botInfo.username} starting in ${config.mode} mode, ${games.length} games loaded`);
  await registerCommands(bot, config.chatId).catch((err) => log.warn('[bot] setMyCommands failed:', err));

  const reminder = config.reminder.enabled
    ? createReminderJob(config.reminder, async () => {
        const result = await flow.sendReminder();
        log.info(`[reminder] ${result}`);
      })
    : undefined;
  if (reminder) {
    log.info(`[reminder] next at ${reminder.nextRun()?.toISOString()} (${config.reminder.days} ${config.reminder.time} ${config.reminder.timezone})`);
  }

  let shutdown: () => Promise<void>;

  if (config.mode === 'webhook') {
    const wh = config.webhook!;
    const handle = webhookCallback(bot, 'http', { secretToken: wh.secret });
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === wh.path) return void handle(req, res);
      if (req.method === 'GET' && req.url === '/healthz') return void res.writeHead(200).end('ok');
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(wh.port, resolve));
    await bot.api.setWebhook(`${wh.url}${wh.path}`, {
      secret_token: wh.secret,
      allowed_updates: [...ALLOWED_UPDATES],
      max_connections: 1,
    });
    log.info(`[bot] webhook set, listening on :${wh.port}${wh.path}`);
    shutdown = async () => void server.close();
  } else {
    // Long polling needs the webhook removed; pending updates are kept so a restart
    // still receives poll closes that happened while the bot was down.
    await bot.api.deleteWebhook();
    bot.start({ allowed_updates: [...ALLOWED_UPDATES] }).catch((err) => {
      log.error('[bot] polling stopped with an error:', err);
      process.exit(1);
    });
    shutdown = () => bot.stop();
  }

  const stop = async (signal: string) => {
    log.info(`[bot] ${signal} received, shutting down`);
    reminder?.stop();
    flow.stop();
    await shutdown().catch((err) => log.warn('[bot] error during shutdown:', err));
    process.exit(0);
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err: unknown) => {
  log.error('[bot] fatal:', err);
  process.exit(1);
});
