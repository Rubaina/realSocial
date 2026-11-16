import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG_DIR, isStale, loadCountries, loadCountry, localize, officeFor, programsFor, seedPrograms, validateProgram } from '../src/catalog/loader';
import { LIMITS } from '../src/catalog/schema';
import { checklist } from '../src/nextsteps/builder';
import { setup } from './helpers';

const countries = loadCountries();
const seeds = seedPrograms();

describe('catalog files', () => {
  it('loads every country with its languages', () => {
    expect([...countries.values()].map((c) => `${c.code}:${c.languages}`).sort()).toEqual(['id:id,en', 'in:en']);
  });

  it('picks one language out of multilingual text and lists', () => {
    const raw = { id: 'x', title: { id: 'Gratis', en: 'Free' }, bring: { id: ['KTP'], en: ['ID card'] }, keep: { other: 1 } };
    expect(localize(raw, 'en', ['id', 'en'])).toEqual({ id: 'x', title: 'Free', bring: ['ID card'], keep: { other: 1 } });
    expect(localize(raw, 'id', ['id', 'en']).title).toBe('Gratis');
  });

  it('every program is complete in every language and fits WhatsApp limits', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(13);
    for (const s of seeds) {
      const country = countries.get(s.country)!;
      const byLang = validateProgram(country, s.raw, s.scope);
      expect(Object.keys(byLang)).toEqual(country.languages);
      for (const p of Object.values(byLang)) {
        expect(p.source_url, p.id).toMatch(/^https:\/\//);
        expect(p.title.length, p.id).toBeLessThanOrEqual(LIMITS.rowTitle);
        expect(p.benefit.length, p.id).toBeLessThanOrEqual(LIMITS.rowDescription);
      }
    }
  });

  it('gives Indonesian and English versions different text but the same rules', () => {
    const seed = seeds.find((s) => s.raw.id === 'sby_sarjana')!;
    const { id, en } = validateProgram(countries.get('id')!, seed.raw, seed.scope);
    expect(id.title).toBe('1 Keluarga 1 Sarjana');
    expect(en.title).toBe('1 Family 1 Graduate');
    expect(en.eligibility).toEqual(id.eligibility);
    expect(en.how_to_apply.in_person!.steps).toHaveLength(id.how_to_apply.in_person!.steps.length);
  });

  it('uses the most local office description, in the right language', () => {
    const c = countries.get('id')!;
    expect(officeFor(c.byLang.id, ['jawa-timur', 'surabaya'], 'kelurahan').name).toBe('Kantor kelurahan di Surabaya');
    expect(officeFor(c.byLang.id, ['lainnya'], 'kelurahan').name).toBe('Kantor kelurahan atau desa');
    expect(officeFor(c.byLang.en, ['jawa-timur', 'surabaya'], 'kelurahan').name).toContain('ward office');
  });

  it('rejects a program that refers to a question that does not exist', () => {
    const seed = seeds.find((s) => s.raw.id === 'sembako')!;
    const broken = JSON.parse(JSON.stringify(seed.raw).replace('"registry"', '"registri"'));
    expect(() => validateProgram(countries.get('id')!, broken, [])).toThrow(/uses fact "registri"/);
  });

  it('rejects a pack with a missing message', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    fs.cpSync(path.join(CATALOG_DIR, 'in'), dir, { recursive: true });
    const file = path.join(dir, 'strings.en.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^docs_prompt:.*\n/m, ''));
    expect(() => loadCountry(dir)).toThrow(/missing docs_prompt/);
  });
});

describe('approved programs', () => {
  it('layers national and regional programs', () => {
    const t = setup();
    const ids = (region: string[]) => programsFor(t.catalog.programs('id', 'id'), region).map((p) => p.id);
    expect(ids(['jawa-timur', 'surabaya'])).toContain('sby_sarjana');
    expect(ids(['jawa-timur', 'surabaya'])).toContain('kip_kuliah');
    expect(ids(['jawa-timur', 'lainnya'])).not.toContain('sby_sarjana');
    expect(ids(['lainnya'])).toContain('pkh');
  });

  it('are dated on approval, and warn again once the check is old', () => {
    const t = setup();
    const pack = t.countries.get('id')!.byLang.id;
    const pkh = t.catalog.programs('id', 'id').find((p) => p.id === 'pkh')!;
    expect(pkh.last_verified).toBe('2026-11-15');
    expect(isStale(pkh, new Date('2026-12-01'))).toBe(false);
    expect(isStale(pkh, new Date('2027-08-01'))).toBe(true);
    expect(checklist(pack, [], pkh, 'in_person', new Date('2026-12-01'))).not.toContain(pack.strings.unverified);
    expect(checklist(pack, [], pkh, 'in_person', new Date('2027-08-01'))).toContain(pack.strings.unverified);
  });
});
