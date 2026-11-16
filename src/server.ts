import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAdmin, type AdminDeps } from './admin/routes';
import { createApp } from './app';
import { claudeComplete } from './extract/draft';
import { parseWebhook, verifySignature, WhatsAppChannel } from './channels/whatsapp';
import type { Engine } from './conversation/engine';
import type { Outbound } from './channels/types';

export interface WebhookDeps {
  engine: Engine;
  channel: { send(to: string, messages: Outbound[]): Promise<void> };
  appSecret: string;
  verifyToken: string;
}

/** The WhatsApp webhook (for citizens) and the review page (for the admin). Either part can be left out. */
export function buildServer(d: { whatsapp?: WebhookDeps; admin?: AdminDeps }) {
  const app = Fastify({ logger: false });

  // Keep the exact bytes: the WhatsApp signature is computed over the raw body.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.get('/health', async () => ({ ok: true }));

  if (d.admin) registerAdmin(app, d.admin);

  if (d.whatsapp) {
    const w = d.whatsapp;
    const seen = new Set<string>();                  // WhatsApp re-delivers webhooks; handle each message once
    const queues = new Map<string, Promise<void>>(); // one message at a time per person

    app.get('/webhook', async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === w.verifyToken) return reply.send(q['hub.challenge']);
      return reply.code(403).send('forbidden');
    });

    app.post('/webhook', async (req, reply) => {
      const raw = req.body as Buffer;
      if (!verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, w.appSecret)) {
        return reply.code(401).send('bad signature');
      }
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send('bad json');
      }
      for (const { id, msg } of parseWebhook(body)) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
        const job = (queues.get(msg.from) ?? Promise.resolve())
          .then(async () => w.channel.send(msg.from, await w.engine.handle(msg)))
          .catch((err) => console.error('failed to handle message:', err instanceof Error ? err.message : err));
        queues.set(msg.from, job);
        void job.finally(() => queues.get(msg.from) === job && queues.delete(msg.from));
      }
      // Acknowledge straight away; replies are sent in the background.
      return reply.send('ok');
    });
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const waKeys = ['WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN'];
  const waSet = waKeys.filter((k) => env[k]);
  const fail = (message: string) => {
    console.error(message);
    process.exit(1);
  };
  if (waSet.length && waSet.length < waKeys.length) fail(`Missing ${waKeys.filter((k) => !env[k]).join(', ')}.`);
  const useWhatsApp = waSet.length === waKeys.length;
  if (!useWhatsApp && !env.ADMIN_TOKEN) fail('Nothing to run: set ADMIN_TOKEN for the review page and/or the WA_* values for WhatsApp (see .env.example).');
  if (useWhatsApp && !env.OPERATOR_NAME) fail('Set OPERATOR_NAME: the person or organisation running this service, shown to people in the first message.');

  const { engine, catalog, countries, store, proposed } = createApp({ operator: env.OPERATOR_NAME ?? '' });
  if (proposed) console.log(`${proposed} program file(s) added to the review queue.`);
  const channel = useWhatsApp
    ? new WhatsAppChannel({ phoneNumberId: env.WA_PHONE_NUMBER_ID!, accessToken: env.WA_ACCESS_TOKEN!, graphVersion: env.WA_GRAPH_VERSION })
    : undefined;
  const port = Number(env.PORT || 3000);
  // The review page has no TLS of its own: keep it on this machine unless a secure proxy sits in front.
  const host = env.HOST || (useWhatsApp ? '0.0.0.0' : '127.0.0.1');
  buildServer({
    whatsapp: channel && { engine, channel, appSecret: env.WA_APP_SECRET!, verifyToken: env.WA_VERIFY_TOKEN! },
    admin: env.ADMIN_TOKEN
      ? {
          catalog,
          store,
          countries,
          token: env.ADMIN_TOKEN,
          filesDir: path.join(path.dirname(env.DB_PATH ?? 'data/app.db'), 'sources'),
          complete: env.ANTHROPIC_API_KEY ? claudeComplete(env.EXTRACT_MODEL || 'claude-opus-5-5') : undefined,
        }
      : undefined,
  })
    .listen({ port, host })
    .then(() => {
      if (useWhatsApp) console.log(`WhatsApp webhook: http://${host}:${port}/webhook`);
      if (env.ADMIN_TOKEN) console.log(`Review page:      http://localhost:${port}/admin`);
      else console.log('Review page is off (ADMIN_TOKEN not set), so no program can be approved.');
    });
}
