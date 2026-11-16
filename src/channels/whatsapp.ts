import crypto from 'node:crypto';
import { LIMITS } from '../catalog/schema';
import type { Inbound, Opt, Outbound } from './types';

const TEXT_MAX = 4096;
const BODY_MAX = 1024;

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** "1. Title - description" lines, so a person can also answer by typing the number. */
export function numberedLines(options: Opt[]): string {
  return options
    .map((o) => `${o.n ? `${o.n}. ` : '› '}${o.title}${o.description ? ` - ${o.description}` : ''}`)
    .join('\n');
}

function chunks(body: string): string[] {
  const out: string[] = [];
  let rest = body;
  while (rest.length > TEXT_MAX) {
    const cut = rest.lastIndexOf('\n', TEXT_MAX);
    const at = cut > 0 ? cut : TEXT_MAX;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

/**
 * Turns engine messages into WhatsApp Cloud API payloads, keeping within the platform limits:
 * up to 3 reply buttons (20-character titles), otherwise a list of up to 10 rows.
 */
export function toPayloads(to: string, messages: Outbound[]): object[] {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  const textMsg = (body: string) => ({ ...base, type: 'text', text: { body, preview_url: false } });
  const payloads: object[] = [];

  for (const m of messages) {
    if (m.kind === 'text') {
      payloads.push(...chunks(m.body).map(textMsg));
      continue;
    }
    const asButtons = m.options.length <= LIMITS.buttons && m.options.every((o) => o.title.length <= LIMITS.buttonTitle);
    let body = asButtons ? m.body : `${m.body}\n\n${numberedLines(m.options)}`;
    if (body.length > BODY_MAX) {
      // Too long for an interactive message: send the text first, then a short prompt with the choices.
      payloads.push(...chunks(body).map(textMsg));
      body = m.button;
    }
    payloads.push({
      ...base,
      type: 'interactive',
      interactive: asButtons
        ? {
            type: 'button',
            body: { text: body },
            action: { buttons: m.options.map((o) => ({ type: 'reply', reply: { id: o.id, title: o.title } })) },
          }
        : {
            type: 'list',
            body: { text: body },
            action: {
              button: clip(m.button, LIMITS.buttonTitle),
              sections: [{
                title: clip(m.button, LIMITS.rowTitle),
                rows: m.options.slice(0, LIMITS.listRows).map((o) => ({
                  id: o.id,
                  title: clip(o.title, LIMITS.rowTitle),
                  ...(o.description ? { description: clip(o.description, LIMITS.rowDescription) } : {}),
                })),
              }],
            },
          },
    });
  }
  return payloads;
}

/** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Extracts the messages we handle from a webhook body. Status updates and unknown types are ignored. */
export function parseWebhook(body: any): { id: string; msg: Inbound }[] {
  const out: { id: string; msg: Inbound }[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const from: string = m.from;
        let msg: Inbound | undefined;
        if (m.type === 'text' && m.text?.body) msg = { from, kind: 'text', text: m.text.body };
        else if (m.type === 'interactive') {
          const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
          if (reply?.id) msg = { from, kind: 'choice', id: reply.id };
        } else if (m.type === 'button' && m.button?.text) msg = { from, kind: 'text', text: m.button.text };
        else if (m.type === 'audio' && m.audio?.id) msg = { from, kind: 'voice', mediaId: m.audio.id };
        else if ((m.type === 'image' || m.type === 'document') && m[m.type]?.id) {
          msg = { from, kind: 'media', mediaId: m[m.type].id, mime: m[m.type].mime_type ?? 'application/octet-stream' };
        }
        if (msg && m.id) out.push({ id: m.id, msg });
      }
    }
  }
  return out;
}

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
}

export class WhatsAppChannel {
  private base: string;
  constructor(private cfg: WhatsAppConfig, private http: typeof fetch = fetch) {
    this.base = `https://graph.facebook.com/${cfg.graphVersion || 'v21.0'}`;
  }

  private auth = () => ({ Authorization: `Bearer ${this.cfg.accessToken}` });

  private async post(payload: object): Promise<void> {
    const res = await this.http(`${this.base}/${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
  }

  /** Sends in order, one at a time, so messages arrive in the order they were written. */
  async send(to: string, messages: Outbound[]): Promise<void> {
    for (const payload of toPayloads(to, messages)) await this.post(payload);
  }
}
