import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCountries, seedPrograms, type Country } from '../src/catalog/loader';
import type { AdminDeps } from '../src/admin/routes';
import { LiveCatalog } from '../src/catalog/live';
import type { Inbound, Opt, Outbound } from '../src/channels/types';
import { Engine } from '../src/conversation/engine';
import { Store } from '../src/store/db';
import { pickLocal } from '../src/understand/intent';
import { transcribe } from '../src/understand/stt';

export function setup(opts: { approve?: boolean; countries?: Map<string, Country> } = {}) {
  const clock = { now: new Date('2026-11-15T03:00:00Z') };
  const countries = opts.countries ?? loadCountries();
  const store = new Store(':memory:', () => clock.now);
  const catalog = new LiveCatalog(countries, store);
  catalog.importSeeds(seedPrograms());
  if (opts.approve !== false) for (const { change } of catalog.pending()) catalog.approve(change.id, 'test reviewer');
  const engine = new Engine({
    countries, catalog, store, operator: 'Test Operator', now: () => clock.now,
    understand: { transcribe, pick: async (t, o) => pickLocal(t, o) },
  });

  const chat = (phone: string) => {
    let last: Outbound[] = [];
    const send = async (m: Record<string, unknown>) => (last = await engine.handle({ from: phone, ...m } as Inbound));
    const options = (): Opt[] => last.flatMap((m) => (m.kind === 'options' ? m.options : []));
    const c = {
      get last() { return last; },
      options,
      titles: () => options().map((o) => o.title),
      body: () => last.map((m) => m.body).join('\n'),
      say: (text: string) => send({ kind: 'text', text }),
      voice: (transcript?: string) => send({ kind: 'voice', mediaId: 'v', transcript }),
      photo: () => send({ kind: 'media', mediaId: 'm', mime: 'image/jpeg' }),
      tapId: (id: string) => send({ kind: 'choice', id }),
      tap: (title: string) => {
        const o = options().find((x) => x.title === title);
        if (!o) throw new Error(`no option "${title}" among: ${c.titles().join(' | ')}`);
        return send({ kind: 'choice', id: o.id });
      },
      /** Answers profile questions until something else is shown. Returns the ids that were asked. */
      async answer(answers: Record<string, string>): Promise<string[]> {
        const user = store.getUser(phone)!;
        const questions = catalog.questions(user.country, user.lang);
        const asked: string[] = [];
        for (;;) {
          const prompt = last.find((m) => m.kind === 'options')?.body;
          const q = questions.find((x) => x.text === prompt);
          if (!q) return asked;
          if (!(q.id in answers)) throw new Error(`unexpected question "${q.id}"`);
          asked.push(q.id);
          await c.tap(q.options.find((o) => o.value === answers[q.id])!.label);
        }
      },
    };
    return c;
  };
  /** Settings for the admin pages, with uploads going to a throwaway folder. */
  const admin = (extra: Partial<AdminDeps> = {}): AdminDeps => ({
    catalog, store, countries, token: 'tok', filesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sources-')), ...extra,
  });
  return { engine, store, catalog, countries, clock, chat, admin };
}

/** A Surabaya household in the social registry with a child who wants to go to university. */
export const SURABAYA_FAMILY = {
  ktp_surabaya: 'yes', registry: 'yes', school_child: 'no', college_bound: 'yes', pregnant_toddler: 'no',
  elderly: 'no', disability: 'no', bpjs: 'no', power: '1300', work: 'employee',
};

export async function toSurabayaResults(c: ReturnType<ReturnType<typeof setup>['chat']>) {
  await c.say('halo');
  await c.tap('Bahasa Indonesia');
  await c.tap('Mulai');
  await c.tap('Jawa Timur');
  await c.tap('Kota Surabaya');
  return c.answer(SURABAYA_FAMILY);
}
