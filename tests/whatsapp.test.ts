import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhook, toPayloads, verifySignature } from '../src/channels/whatsapp';
import type { Outbound } from '../src/channels/types';
import { buildServer } from '../src/server';
import { setup } from './helpers';

const envelope = (message: object) => ({ entry: [{ changes: [{ value: { messages: [message] } }] }] });

describe('outgoing messages', () => {
  it('uses reply buttons for up to three short options', () => {
    const [p] = toPayloads('62', [{ kind: 'options', body: 'Pilih', button: 'Pilih', options: [{ id: '1|yes', title: 'Ya', n: 1 }, { id: '1|no', title: 'Tidak', n: 2 }] }]) as any[];
    expect(p.interactive.type).toBe('button');
    expect(p.interactive.action.buttons.map((b: any) => b.reply)).toEqual([{ id: '1|yes', title: 'Ya' }, { id: '1|no', title: 'Tidak' }]);
  });

  it('uses a list otherwise, with numbered one-line options in the text', () => {
    const options = Array.from({ length: 5 }, (_, i) => ({ id: `1|p${i}`, title: `Program ${i}`, description: 'x'.repeat(90), n: i + 1 }));
    const [p] = toPayloads('62', [{ kind: 'options', body: 'Anda mungkin bisa mendapat:', button: 'Pilih', options }]) as any[];
    expect(p.interactive.type).toBe('list');
    expect(p.interactive.body.text).toContain('1. Program 0');
    const rows = p.interactive.action.sections[0].rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((r: any) => r.title.length <= 24 && r.description.length <= 72)).toBe(true);
  });

  it('never exceeds WhatsApp limits for any prompt the real catalog can produce', async () => {
    const t = setup();
    for (const phone of ['6281234567890', '919812345678']) {
      const c = t.chat(phone);
      const seen: Outbound[] = [];
      const check = () => seen.push(...c.last);
      await c.say('hi'); check();
      await c.tapId(c.options()[0].id); check();
      for (let i = 0; i < 40 && c.options().length; i++) { await c.tapId(c.options()[0].id); check(); }
      for (const p of toPayloads(phone, seen) as any[]) {
        if (p.type === 'text') expect(p.text.body.length).toBeLessThanOrEqual(4096);
        else {
          expect(p.interactive.body.text.length).toBeLessThanOrEqual(1024);
          for (const b of p.interactive.action.buttons ?? []) expect(b.reply.title.length).toBeLessThanOrEqual(20);
          expect(p.interactive.action.buttons?.length ?? 0).toBeLessThanOrEqual(3);
          expect(p.interactive.action.sections?.[0].rows.length ?? 0).toBeLessThanOrEqual(10);
        }
      }
    }
  });
});

describe('incoming webhooks', () => {
  it('reads text, taps, voice notes and photos', () => {
    const parse = (m: object) => parseWebhook(envelope({ id: 'wamid.1', from: '62811', ...m }))[0]?.msg;
    expect(parse({ type: 'text', text: { body: 'halo' } })).toEqual({ from: '62811', kind: 'text', text: 'halo' });
    expect(parse({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: '3|yes', title: 'Ya' } } })).toEqual({ from: '62811', kind: 'choice', id: '3|yes' });
    expect(parse({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '4|p:pkh' } } })).toEqual({ from: '62811', kind: 'choice', id: '4|p:pkh' });
    expect(parse({ type: 'audio', audio: { id: 'A1' } })).toEqual({ from: '62811', kind: 'voice', mediaId: 'A1' });
    expect(parse({ type: 'image', image: { id: 'I1', mime_type: 'image/jpeg' } })).toEqual({ from: '62811', kind: 'media', mediaId: 'I1', mime: 'image/jpeg' });
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] })).toEqual([]);
  });

  it('checks the signature', () => {
    const raw = Buffer.from('{"a":1}');
    const good = `sha256=${crypto.createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    expect(verifySignature(raw, good, 'secret')).toBe(true);
    expect(verifySignature(raw, good, 'other')).toBe(false);
    expect(verifySignature(Buffer.from('{"a":2}'), good, 'secret')).toBe(false);
    expect(verifySignature(raw, undefined, 'secret')).toBe(false);
  });

  it('answers a signed message once, and rejects unsigned ones', async () => {
    const t = setup();
    const sent: { to: string; messages: Outbound[] }[] = [];
    const channel = { send: async (to: string, messages: Outbound[]) => void sent.push({ to, messages }) };
    const app = buildServer({ whatsapp: { engine: t.engine, channel, appSecret: 'secret', verifyToken: 'verify-me' } });

    const payload = JSON.stringify(envelope({ id: 'wamid.9', from: '6281234567890', type: 'text', text: { body: 'halo' } }));
    const sign = (s: string) => `sha256=${crypto.createHmac('sha256', 'secret').update(s).digest('hex')}`;
    const post = (signature?: string) => app.inject({ method: 'POST', url: '/webhook', payload, headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) } });

    expect((await post()).statusCode).toBe(401);
    expect((await post(sign('tampered'))).statusCode).toBe(401);
    expect(sent).toHaveLength(0);

    expect((await post(sign(payload))).statusCode).toBe(200);
    expect((await post(sign(payload))).statusCode).toBe(200);   // WhatsApp re-delivery
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('6281234567890');
    expect(sent[0].messages[0].body).toContain('Pilih bahasa');
    expect((await app.inject({ url: '/admin' })).statusCode).toBe(404);   // review page is off unless configured

    const verify = await app.inject({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345' });
    expect(verify.body).toBe('12345');
    expect((await app.inject({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1' })).statusCode).toBe(403);
  });
});
