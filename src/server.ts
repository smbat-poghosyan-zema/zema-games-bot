import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface ServerOptions {
  /** Path Telegram posts updates to. */
  webhookPath: string;
  /** grammY webhook handler (checks the Telegram secret token itself). */
  onUpdate: (req: IncomingMessage, res: ServerResponse) => unknown;
  /** Bearer token for /cron/reminder; the endpoint returns 404 when unset. */
  cronSecret?: string;
  /** Called by /cron/reminder; returns a short status for the response body. */
  onReminder: () => Promise<string>;
}

function bearerMatches(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * HTTP server for webhook mode:
 * - POST {webhookPath}: Telegram updates
 * - GET  /healthz: health check (also used by an external pinger to keep a free host awake)
 * - GET|POST /cron/reminder: lets an external scheduler trigger the daily reminder when the
 *   host may be asleep at reminder time
 */
export function createHttpServer(opts: ServerOptions): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    if (req.method === 'POST' && path === opts.webhookPath) return void opts.onUpdate(req, res);

    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/healthz') {
      return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    }

    if ((req.method === 'GET' || req.method === 'POST') && path === '/cron/reminder' && opts.cronSecret) {
      if (!bearerMatches(req.headers.authorization, opts.cronSecret)) return void res.writeHead(401).end();
      opts
        .onReminder()
        .then((status) => res.writeHead(200, { 'content-type': 'text/plain' }).end(status))
        .catch(() => res.writeHead(500).end('error'));
      return;
    }

    res.writeHead(404).end();
  });
}
