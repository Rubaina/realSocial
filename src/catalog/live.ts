import type { Change, Store } from '../store/db';
import { fileQuestions, validateProgram, validateQuestions, type Country, type QuestionsByLang, type SeedProgram } from './loader';
import type { Program, Question } from './schema';

export interface ChangeInput {
  country: string;
  scope: string[];
  kind: 'upsert' | 'remove';
  raw: any;
  /** New questions the program needs (multilingual, like program text). Optional. */
  questions?: any[];
  note: string;
  by: string;
}

const withoutVerified = (raw: any) => {
  const { last_verified: _ignored, ...rest } = raw ?? {};
  return JSON.stringify(rest);
};

const merge = (a: QuestionsByLang, b: QuestionsByLang): QuestionsByLang =>
  Object.fromEntries(Object.keys(a).map((l) => [l, [...a[l], ...(b[l] ?? [])]]));

/**
 * The gate between what the team writes and what people see. Every new program, edit and new question is
 * stored as a pending change; only changes a human reviewer has approved are served to the chat.
 */
export class LiveCatalog {
  private cache?: { version: number; programs: Map<string, Program[]>; questions: Map<string, QuestionsByLang> };

  constructor(private countries: Map<string, Country>, private store: Store) {}

  private current() {
    const version = this.store.catalogVersion();
    if (this.cache?.version !== version) this.cache = { version, ...this.build() };
    return this.cache;
  }

  /** Approved programs for a country, in one language. */
  programs(country: string, lang: string): Program[] {
    return this.current().programs.get(`${country}/${lang}`) ?? [];
  }

  /** The questions the bot may ask: those in the country's files plus approved new ones. */
  questions(country: string, lang: string): Question[] {
    return this.allQuestions(country)[lang] ?? [];
  }

  allQuestions(country: string): QuestionsByLang {
    return this.current().questions.get(country) ?? {};
  }

  private build() {
    const live = this.store.liveChanges();
    const questions = new Map<string, QuestionsByLang>();
    for (const country of this.countries.values()) questions.set(country.code, fileQuestions(country));
    // First the questions that approved programs brought with them, in approval order...
    for (const change of live) {
      const country = this.countries.get(change.country);
      if (!country || !change.questions.length) continue;
      try {
        const have = questions.get(country.code)!;
        const fresh = change.questions.filter((q) => !have[country.languages[0]].some((x) => x.id === q?.id));
        questions.set(country.code, merge(have, validateQuestions(country, fresh, have)));
      } catch (err) {
        console.error(`questions of approved program "${change.programId}" are no longer valid:`, err instanceof Error ? err.message : err);
      }
    }
    // ...then the programs, checked against the full question list.
    const programs = new Map<string, Program[]>();
    for (const change of live) {
      const country = this.countries.get(change.country);
      if (!country) continue;
      try {
        for (const [lang, program] of Object.entries(validateProgram(country, change.data, change.scope, questions.get(country.code)))) {
          const key = `${change.country}/${lang}`;
          programs.set(key, [...(programs.get(key) ?? []), program]);
        }
      } catch (err) {
        // For example a question it relied on was withdrawn. Hide the program rather than crash.
        console.error(`approved program "${change.programId}" is no longer valid and is hidden:`, err instanceof Error ? err.message : err);
      }
    }
    return { programs, questions };
  }

  /**
   * Checks a program together with the new questions it proposes. Returns only the questions that are
   * really new (ones already live are dropped). Throws with a readable message if anything is wrong.
   */
  check(countryCode: string, raw: unknown, scope: string[], questions: any[] = []): any[] {
    const country = this.countries.get(countryCode);
    if (!country) throw new Error(`unknown country "${countryCode}"`);
    const have = this.allQuestions(countryCode);
    const fresh = questions.filter((q) => !have[country.languages[0]].some((x) => x.id === q?.id));
    validateProgram(country, raw, scope, merge(have, validateQuestions(country, fresh, have)));
    return fresh;
  }

  /** Stores a proposal as pending. Throws if it is not well-formed, so reviewers only see valid entries. */
  submit(input: ChangeInput): number {
    if (!this.countries.has(input.country)) throw new Error(`unknown country "${input.country}"`);
    if (!input.note.trim()) throw new Error('a note saying what changed and where it was announced is required');
    const programId = input.raw?.id;
    if (typeof programId !== 'string' || !programId) throw new Error('there is no program to save yet: the program text is empty or has no "id"');
    let questions: any[] = [];
    if (input.kind === 'remove') {
      if (!this.store.liveChanges().some((c) => c.country === input.country && c.programId === programId)) {
        throw new Error(`"${programId}" is not live, so it cannot be removed`);
      }
    } else {
      questions = this.check(input.country, input.raw, input.scope, input.questions);
    }
    return this.store.addChange({
      country: input.country, programId, scope: input.scope, kind: input.kind,
      data: input.raw, questions, note: input.note.trim(), submittedBy: input.by,
    });
  }

  /** Proposes every program file that is new or differs from what the files last proposed. Returns how many. */
  importSeeds(seeds: SeedProgram[], by = 'catalog files'): number {
    let submitted = 0;
    for (const seed of seeds) {
      // Compare with what the files last proposed, not with edits made on the review page: otherwise a
      // restart would re-propose the old file text and compete with a reviewer's newer edit.
      const latest = this.store.latestChange(seed.country, seed.raw?.id, by);
      const unchanged = latest?.kind === 'upsert' && withoutVerified(latest.data) === withoutVerified(seed.raw)
        && JSON.stringify(latest.scope) === JSON.stringify(seed.scope);
      if (unchanged) continue;
      this.submit({ ...seed, kind: 'upsert', by, note: latest ? 'Edited in the catalog files.' : 'New program from the catalog files.' });
      submitted += 1;
    }
    return submitted;
  }

  /** The reviewer confirms the entry against the official source; it goes live and is dated as verified today. */
  approve(id: number, by: string): void {
    const change = this.pendingChange(id);
    let data: unknown;
    if (change.kind === 'upsert') {
      this.check(change.country, change.data, change.scope, change.questions);
      data = { ...change.data, last_verified: this.store.now().toISOString().slice(0, 10) };
    }
    if (!this.store.reviewChange(id, 'approved', by, null, data)) throw new Error('this change was already reviewed');
  }

  reject(id: number, by: string, reason: string): void {
    this.pendingChange(id);
    if (!reason.trim()) throw new Error('a reason is required when rejecting');
    if (!this.store.reviewChange(id, 'rejected', by, reason.trim())) throw new Error('this change was already reviewed');
  }

  private pendingChange(id: number): Change {
    const change = this.store.getChange(id);
    if (!change) throw new Error('no such change');
    if (change.status !== 'pending') throw new Error('this change was already reviewed');
    return change;
  }

  /** The review queue, each with the version people currently see (if any) and which fields differ. */
  pending(): { change: Change; live: any | null; changedFields: string[] }[] {
    const live = this.store.liveChanges();
    return this.store.changes('pending').map((change) => {
      const current = live.find((c) => c.country === change.country && c.programId === change.programId)?.data ?? null;
      const keys = new Set([...Object.keys(change.data ?? {}), ...Object.keys(current ?? {})]);
      keys.delete('last_verified');
      const changedFields = current && change.kind === 'upsert'
        ? [...keys].filter((k) => JSON.stringify(change.data[k]) !== JSON.stringify(current[k]))
        : [];
      return { change, live: current, changedFields };
    });
  }

  liveSummary(): { country: string; programId: string; scope: string[]; verified: string | null; approvedBy: string | null; data: any }[] {
    return this.store.liveChanges().map((c) => ({
      country: c.country, programId: c.programId, scope: c.scope, verified: c.data.last_verified ?? null, approvedBy: c.reviewedBy, data: c.data,
    }));
  }
}
