import Anthropic from '@anthropic-ai/sdk';
import type { Inbound, Opt } from '../channels/types';
import { transcribe } from './stt';

export interface Understand {
  /** Text of a voice note, or null if it cannot be transcribed. */
  transcribe(msg: Extract<Inbound, { kind: 'voice' }>): Promise<string | null>;
  /** The id of the option the person meant, or null when it is not clear. Never invents an option. */
  pick(text: string, options: Opt[], language: string): Promise<string | null>;
}

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const YES = new Set(['ya', 'iya', 'iyaa', 'y', 'yes', 'yup', 'betul', 'benar', 'ada', 'punya', 'haan', 'ha']);
const NO = new Set(['tidak', 'tdk', 'nggak', 'ngga', 'gak', 'ga', 'enggak', 'no', 'n', 'bukan', 'tidak ada', 'nahi', 'nahin']);
const STOP = new Set(['saya', 'aku', 'yang', 'dan', 'di', 'ke', 'itu', 'ini', 'the', 'a', 'i', 'my', 'is', 'to', 'atau', 'or']);

/** Cheap matching that needs no network: yes/no words, the option's own words, or a clear best word overlap. */
export function pickLocal(text: string, options: Opt[]): string | null {
  const t = norm(text);
  if (!t) return null;
  if (YES.has(t) && options.some((o) => o.id === 'yes')) return 'yes';
  if (NO.has(t) && options.some((o) => o.id === 'no')) return 'no';

  const contains = options.filter((o) => {
    const title = norm(o.title);
    return title.length >= 3 && (t.includes(title) || (t.length >= 3 && title.includes(t)));
  });
  if (contains.length === 1) return contains[0].id;

  const words = new Set(t.split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
  const scored = options
    .map((o) => ({ id: o.id, score: norm(o.title).split(' ').filter((w) => words.has(w)).length }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score > 0 && scored[0].score > (scored[1]?.score ?? 0)) return scored[0].id;
  return null;
}

const SYSTEM = `You help a WhatsApp assistant understand which menu option a person meant.
The person may have little schooling and may write informally, with typos, or in a local language.
You are given the numbered options currently on screen and the person's message.
Reply with only the number of the option the message clearly chooses. Reply 0 if the message does not clearly choose one of them, asks something else, or could mean more than one option. Do not guess.`;

/** Asks a small Claude model. It can only return one of the given options or "not sure". */
export function pickWithClaude(client: Anthropic, model: string) {
  return async (text: string, options: Opt[], language: string): Promise<string | null> => {
    const list = options.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` (${o.description})` : ''}`).join('\n');
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Language code: ${language}\n\nOptions:\n${list}\n\nMessage:\n${text}` }],
      });
      if (response.stop_reason === 'refusal') return null;
      const reply = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
      const n = /^\d+$/.test(reply) ? Number(reply) : 0;
      return options[n - 1]?.id ?? null;
    } catch (err) {
      // The chat must keep working when the model is unreachable; the bot simply re-shows the options.
      console.error('intent model unavailable:', err instanceof Error ? err.message : err);
      return null;
    }
  };
}

export function createUnderstand(env: NodeJS.ProcessEnv = process.env): Understand {
  const remote = env.ANTHROPIC_API_KEY
    ? pickWithClaude(new Anthropic({ timeout: 15_000, maxRetries: 1 }), env.INTENT_MODEL || 'claude-haiku-5-5')
    : null;
  return {
    transcribe,
    async pick(text, options, language) {
      return pickLocal(text, options) ?? (remote ? remote(text, options, language) : null);
    },
  };
}
