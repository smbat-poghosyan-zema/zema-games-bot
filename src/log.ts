import { inspect } from 'node:util';

// Bot API URLs look like https://api.telegram.org/bot<id>:<secret>/method. Network errors
// from grammY can include that URL, so everything we log goes through redact().
const TOKEN_RE = /\d{6,}:[A-Za-z0-9_-]{30,}/g;

export function redact(text: string): string {
  return text.replace(TOKEN_RE, '<redacted-token>');
}

function format(value: unknown): string {
  return typeof value === 'string' ? value : inspect(value, { depth: 4 });
}

export const log = {
  info: (...parts: unknown[]) => console.log(redact(parts.map(format).join(' '))),
  warn: (...parts: unknown[]) => console.warn(redact(parts.map(format).join(' '))),
  error: (...parts: unknown[]) => console.error(redact(parts.map(format).join(' '))),
};

/** Last line of defence: never let an unhandled error print the token. */
export function installProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => log.error('[process] unhandled rejection:', reason));
  process.on('uncaughtException', (err) => {
    log.error('[process] uncaught exception:', err);
    process.exit(1);
  });
}
