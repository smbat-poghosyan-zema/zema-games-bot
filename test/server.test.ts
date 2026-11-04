import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/server.js';

const SECRET = 'cron-secret-0123456789';

describe('webhook HTTP server', () => {
  let close: () => void = () => undefined;
  afterEach(() => close());

  async function start(cronSecret?: string) {
    const onUpdate = vi.fn((_req, res) => res.writeHead(200).end('update'));
    const onReminder = vi.fn(async () => 'sent');
    const server = createHttpServer({ webhookPath: '/telegram', onUpdate, onReminder, ...(cronSecret ? { cronSecret } : {}) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => server.close();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, onUpdate, onReminder };
  }

  it('serves health and forwards Telegram updates', async () => {
    const { base, onUpdate } = await start();
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    expect((await fetch(`${base}/telegram`, { method: 'POST', body: '{}' })).status).toBe(200);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect((await fetch(`${base}/telegram`)).status).toBe(404);
  });

  it('runs the reminder only with the right bearer token', async () => {
    const { base, onReminder } = await start(SECRET);
    expect((await fetch(`${base}/cron/reminder`)).status).toBe(401);
    expect((await fetch(`${base}/cron/reminder`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await fetch(`${base}/cron/reminder`, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('sent');
    expect(onReminder).toHaveBeenCalledOnce();
  });

  it('hides the reminder endpoint when no secret is configured', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/cron/reminder`)).status).toBe(404);
  });
});
