import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  BUTTON_KEYS, LIMITS, OfficeSchema, PackMetaSchema, ProgramSchema, QuestionSchema, STRING_KEYS,
  type Office, type PackMeta, type Program, type Question, type RegionNode, type Rule, type Strings,
} from './schema';

/** Everything a country says in one language, except its programs (those come from the approved list). */
export interface Pack {
  meta: PackMeta;
  language: string;
  strings: Strings;
  questions: Question[];
  offices: Record<string, Office>;
  regionOffices: { scope: string[]; offices: Record<string, Partial<Office>> }[];
}

export interface Country {
  code: string;
  languages: string[];
  phonePrefix: string;
  byLang: Record<string, Pack>;
}

/** A program file as written by the team: text fields may hold one value per language. */
export interface SeedProgram {
  country: string;
  scope: string[];
  raw: any;
}

export const CATALOG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../catalog');

const readYaml = (file: string) => parse(fs.readFileSync(file, 'utf8'));

function check<T>(where: string, value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`${where}: ${issues}`);
  }
  return result.data;
}

/**
 * Picks one language out of multilingual data. Any mapping whose keys are exactly the pack's language
 * codes, e.g. { id: "Gratis", en: "Free" }, is replaced by the value for `lang`. Works for text and lists.
 */
export function localize(value: any, lang: string, languages: string[]): any {
  if (Array.isArray(value)) return value.map((v) => localize(v, lang, languages));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (languages.length > 1 && keys.length === languages.length && languages.every((l) => keys.includes(l))) {
      return localize(value[lang], lang, languages);
    }
    return Object.fromEntries(keys.map((k) => [k, localize(value[k], lang, languages)]));
  }
  return value;
}

const yamlFiles = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort() : [];

export function ruleFacts(rule: Rule): { fact: string; in: string[] }[] {
  if ('fact' in rule) return [rule];
  if ('not' in rule) return ruleFacts(rule.not);
  return ('all' in rule ? rule.all : rule.any).flatMap(ruleFacts);
}

export function nodesAt(regions: RegionNode[], scope: string[]): RegionNode[] | undefined {
  let nodes: RegionNode[] | undefined = regions;
  for (const id of scope) nodes = nodes?.find((n) => n.id === id)?.children;
  return nodes;
}

function regionExists(regions: RegionNode[], scope: string[]): boolean {
  if (scope.length === 0) return true;
  return !!nodesAt(regions, scope.slice(0, -1))?.some((n) => n.id === scope.at(-1));
}

/** Walks national/ and regions/<...>/, calling back with each YAML file and the region it applies to. */
function walkPrograms(dir: string, visit: (file: string, name: string, scope: string[]) => void): void {
  for (const f of yamlFiles(path.join(dir, 'national'))) visit(path.join(dir, 'national', f), f, []);
  const walk = (folder: string, scope: string[]) => {
    if (!fs.existsSync(folder)) return;
    if (scope.length) for (const f of yamlFiles(folder)) visit(path.join(folder, f), f, scope);
    for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(folder, e.name), [...scope, e.name]);
    }
  };
  walk(path.join(dir, 'regions'), []);
}

export function loadCountry(dir: string): Country {
  const rawMeta = readYaml(path.join(dir, 'pack.yaml'));
  const languages: string[] = check(`${dir}/pack.yaml`, rawMeta?.languages, z.array(z.string().min(1)).min(1));
  const rawQuestions = readYaml(path.join(dir, 'questions.yaml'));
  const rawOffices = readYaml(path.join(dir, 'offices.yaml'));
  const rawRegionOffices: { scope: string[]; raw: unknown; file: string }[] = [];
  walkPrograms(dir, (file, name, scope) => {
    if (name === 'offices.yaml') rawRegionOffices.push({ scope, raw: readYaml(file), file });
  });

  const byLang: Record<string, Pack> = {};
  for (const lang of languages) {
    const loc = (v: unknown) => localize(v, lang, languages);
    const meta = check(`${dir}/pack.yaml [${lang}]`, loc(rawMeta), PackMetaSchema);
    const stringsFile = path.join(dir, `strings.${lang}.yaml`);
    const rawStrings = check(stringsFile, readYaml(stringsFile), z.record(z.string(), z.string()));
    const missing = STRING_KEYS.filter((k) => !rawStrings[k]);
    if (missing.length) throw new Error(`${stringsFile}: missing ${missing.join(', ')}`);
    const strings = rawStrings as Strings;
    for (const k of BUTTON_KEYS) {
      if (strings[k].length > LIMITS.buttonTitle) throw new Error(`${stringsFile}: "${k}" is longer than ${LIMITS.buttonTitle} characters`);
    }
    const regionOffices = rawRegionOffices
      .map((r) => {
        if (!regionExists(meta.regions, r.scope)) throw new Error(`${r.file}: region "${r.scope.join('/')}" is not listed in pack.yaml`);
        return { scope: r.scope, offices: check(`${r.file} [${lang}]`, loc(r.raw), z.record(z.string(), OfficeSchema.partial())) };
      })
      .sort((a, b) => a.scope.length - b.scope.length);
    byLang[lang] = {
      meta,
      language: lang,
      strings,
      questions: check(`${dir}/questions.yaml [${lang}]`, loc(rawQuestions), z.array(QuestionSchema)),
      offices: check(`${dir}/offices.yaml [${lang}]`, loc(rawOffices), z.record(z.string(), OfficeSchema)),
      regionOffices,
    };
  }
  const first = byLang[languages[0]];
  return { code: first.meta.code, languages, phonePrefix: first.meta.phone_prefix, byLang };
}

export function loadCountries(root = CATALOG_DIR): Map<string, Country> {
  const countries = new Map<string, Country>();
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const country = loadCountry(path.join(root, e.name));
    if (country.code !== e.name) throw new Error(`${root}/${e.name}: pack.yaml code must be "${e.name}"`);
    countries.set(country.code, country);
  }
  if (!countries.size) throw new Error(`${root}: no country packs found`);
  return countries;
}

/** The program files on disk. They are proposals: nothing here reaches people until a reviewer approves it. */
export function seedPrograms(root = CATALOG_DIR): SeedProgram[] {
  const seeds: SeedProgram[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    walkPrograms(path.join(root, e.name), (file, name, scope) => {
      if (name !== 'offices.yaml') seeds.push({ country: e.name, scope, raw: readYaml(file) });
    });
  }
  return seeds;
}

/**
 * Checks a program in every language of its country and returns the per-language versions.
 * Throws with a readable message when something is wrong: a typo would otherwise silently hide a program.
 */
export type QuestionsByLang = Record<string, Question[]>;

/** The questions written in the country's files, per language. */
export const fileQuestions = (country: Country): QuestionsByLang =>
  Object.fromEntries(country.languages.map((l) => [l, country.byLang[l].questions]));

/**
 * Checks newly proposed questions in every language. They must be complete, fit WhatsApp limits, and
 * not reuse the id of a question that already exists.
 */
export function validateQuestions(country: Country, raw: unknown, existing: QuestionsByLang): QuestionsByLang {
  const out: QuestionsByLang = {};
  for (const lang of country.languages) {
    const list = check(`new questions [${lang}]`, localize(raw ?? [], lang, country.languages), z.array(QuestionSchema));
    const seen = new Set((existing[lang] ?? []).map((q) => q.id));
    for (const q of list) {
      if (!/^[a-z0-9_]+$/.test(q.id)) throw new Error(`question id "${q.id}" may only use lowercase letters, digits and underscores`);
      if (seen.has(q.id)) throw new Error(`a question with id "${q.id}" already exists`);
      seen.add(q.id);
    }
    out[lang] = list;
  }
  return out;
}

export function validateProgram(country: Country, raw: unknown, scope: string[], questions: QuestionsByLang = fileQuestions(country)): Record<string, Program> {
  const out: Record<string, Program> = {};
  for (const lang of country.languages) {
    const pack = country.byLang[lang];
    const p = check(`program [${lang}]`, localize(raw, lang, country.languages), ProgramSchema);
    if (!regionExists(pack.meta.regions, scope)) throw new Error(`region "${scope.join('/')}" is not listed for ${country.code}`);
    for (const { fact, in: values } of ruleFacts(p.eligibility)) {
      const q = (questions[lang] ?? []).find((x) => x.id === fact);
      if (!q) throw new Error(`"${p.id}" uses fact "${fact}" but there is no such question`);
      const bad = values.filter((v) => !q.options.some((o) => o.value === v));
      if (bad.length) throw new Error(`"${p.id}" uses unknown answer(s) "${bad.join(', ')}" for "${fact}"`);
    }
    const office = p.how_to_apply.in_person?.office;
    if (office && !pack.offices[office]) throw new Error(`"${p.id}" refers to unknown office "${office}"`);
    out[lang] = { ...p, scope };
  }
  return out;
}

const isPrefix = (scope: string[], region: string[]) => scope.every((s, i) => region[i] === s);

/** National programs plus those of every region level the person belongs to. */
export const programsFor = (programs: Program[], region: string[]) => programs.filter((p) => isPrefix(p.scope, region));

/** The office description for this person's area: the most local override wins. */
export function officeFor(pack: Pack, region: string[], id: string): Office {
  let office = pack.offices[id];
  for (const r of pack.regionOffices) if (isPrefix(r.scope, region) && r.offices[id]) office = { ...office, ...r.offices[id] };
  return office;
}

export const isStale = (p: Program, now: Date, maxDays = 180) =>
  !p.last_verified || now.getTime() - Date.parse(p.last_verified) > maxDays * 86_400_000;

export const fmt = (template: string, vars: Record<string, string | number> = {}) =>
  template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
