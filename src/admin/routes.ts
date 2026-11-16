import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parse, stringify } from 'yaml';
import type { LiveCatalog } from '../catalog/live';
import { nodesAt, type Country } from '../catalog/loader';
import type { RegionNode } from '../catalog/schema';
import { draftProgram, type Complete } from '../extract/draft';
import { fetchSource, htmlToText, type Source } from '../extract/fetch';
import type { SavedSource, Store } from '../store/db';
import { PAGE } from './page';

export interface AdminDeps {
  catalog: LiveCatalog;
  store: Store;
  countries: Map<string, Country>;
  /** Password for the single reviewer. The name typed at sign-in is recorded with each decision. */
  token: string;
  /** Where uploaded source documents are kept. */
  filesDir: string;
  /** Needed for "read and draft". Left out when no model access is configured. */
  complete?: Complete;
  fetchSource?: (url: string) => Promise<Source>;
}

const UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'text/plain': '.txt', 'text/html': '.html',
};
const MAX_UPLOAD = 8 * 1024 * 1024;

const same = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

const httpUrl = (value: unknown, what: string): string => {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* fall through */ }
  throw new Error(`${what} must be a web address starting with https://`);
};

/** Every region path of a country, for the picker: "East Java / Surabaya City". */
function regionPaths(nodes: RegionNode[], prefix: string[] = [], names: string[] = []): { path: string; name: string }[] {
  return nodes.flatMap((n) => {
    const here = { path: [...prefix, n.id].join('/'), name: [...names, n.name].join(' / ') };
    return [here, ...regionPaths(n.children ?? [], [...prefix, n.id], [...names, n.name])];
  });
}

/** Admin-only pages: keep sources, extract drafts from them, review, approve. Citizens never see any of this. */
export function registerAdmin(app: FastifyInstance, d: AdminDeps): void {
  const reviewer = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const header = req.headers.authorization ?? '';
    const [name, ...rest] = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8').split(':') : [];
    if (name?.trim() && same(rest.join(':'), d.token)) return name.trim();
    reply.code(401).header('WWW-Authenticate', 'Basic realm="Program review", charset="UTF-8"').send('Sign in required');
    return null;
  };
  // The server keeps request bodies as raw bytes (needed for WhatsApp signatures), so parse here.
  const body = (req: FastifyRequest): any => {
    try {
      return JSON.parse((req.body as Buffer | undefined)?.toString('utf8') || '{}');
    } catch {
      return {};
    }
  };
  const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
  const fail = (reply: FastifyReply, err: unknown) => reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  /** Runs an action for a signed-in reviewer and turns thrown errors into readable 400 responses. */
  const route = (method: 'get' | 'post', url: string, action: (who: string, req: FastifyRequest) => unknown, opts: { bodyLimit?: number } = {}) => {
    app[method](url, opts, async (req, reply) => {
      const who = reviewer(req, reply);
      if (!who) return reply;
      try {
        return reply.send({ ok: true, result: (await action(who, req)) ?? null });
      } catch (err) {
        return fail(reply, err);
      }
    });
  };
  const viewLang = (c: Country) => (c.languages.includes('en') ? 'en' : c.languages[0]);
  const scopeOf = (c: Country, value: unknown): string[] => {
    const scope = String(value ?? '').split('/').map((s) => s.trim()).filter(Boolean);
    const pack = c.byLang[c.languages[0]];
    if (scope.length && !nodesAt(pack.meta.regions, scope.slice(0, -1))?.some((n) => n.id === scope.at(-1))) throw new Error('choose a region from the list');
    return scope;
  };
  const countryOf = (code: unknown): Country => {
    const c = d.countries.get(String(code ?? ''));
    if (!c) throw new Error('choose a country');
    return c;
  };

  app.get('/admin', async (req, reply) => {
    if (!reviewer(req, reply)) return reply;
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(PAGE);
  });

  route('get', '/admin/api/state', (who) => {
    const sources = d.store.sources();
    const drafts = d.store.openDrafts();
    return {
      reviewer: who,
      canExtract: !!d.complete,
      countries: [...d.countries.values()].map((c) => {
        const lang = viewLang(c);
        const pack = c.byLang[lang];
        return {
          code: c.code, name: pack.meta.name, languages: c.languages,
          regions: regionPaths(pack.meta.regions),
          questions: d.catalog.questions(c.code, lang).map((q) => ({ id: q.id, text: q.text, options: q.options })),
          offices: Object.entries(pack.offices).map(([id, o]) => ({ id, name: o.name })),
        };
      }),
      sources: sources.map((s) => ({
        id: s.id, country: s.country, scope: s.scope, title: s.title, url: s.url, fileName: s.fileName, addedBy: s.addedBy, addedAt: s.addedAt,
        openDrafts: drafts.filter((x) => x.sourceId === s.id).length,
      })),
      drafts: drafts.map((x) => {
        const s = sources.find((y) => y.id === x.sourceId);
        return { ...x, sourceTitle: s?.title ?? '(source removed)', sourceUrl: s?.url ?? null, sourceFile: s?.fileName ?? null };
      }),
      pending: d.catalog.pending().map(({ change, live, changedFields }) => ({
        id: change.id, country: change.country, programId: change.programId, scope: change.scope, kind: change.kind,
        note: change.note, submittedBy: change.submittedBy, submittedAt: change.submittedAt, changedFields,
        proposed: change.kind === 'remove' ? '' : stringify(change.data),
        questions: change.questions.length ? stringify(change.questions) : '',
        live: live ? stringify(live) : '',
      })),
      live: d.catalog.liveSummary().map((p) => {
        const c = d.countries.get(p.country);
        const title = p.data?.title;
        return { country: p.country, programId: p.programId, scope: p.scope, verified: p.verified, approvedBy: p.approvedBy,
          title: typeof title === 'string' ? title : title?.[c ? viewLang(c) : 'en'] ?? p.programId };
      }),
    };
  });

  // ---- 1. Sources: keep a link or document for a country or region. Nothing is read yet. ----

  route('post', '/admin/api/sources', (who, req) => {
    const b = body(req);
    const country = countryOf(b.country);
    const scope = scopeOf(country, b.scope);
    const title = String(b.title ?? '').trim();
    if (!title) throw new Error('give the source a short name, so you can find it later');
    const url = httpUrl(b.url, b.file ? 'The web address this document came from' : 'The link');
    let file: Pick<SavedSource, 'fileName' | 'fileType' | 'filePath'> = { fileName: null, fileType: null, filePath: null };
    if (b.file) {
      const type = String(b.file.type ?? '').toLowerCase();
      const ext = UPLOAD_TYPES[type];
      if (!ext) throw new Error('that kind of file cannot be read; upload a PDF, a JPG/PNG image, or a text file');
      const data = Buffer.from(String(b.file.data ?? ''), 'base64');
      if (!data.length) throw new Error('the uploaded file is empty');
      if (data.length > MAX_UPLOAD || (type.startsWith('image/') && data.length > 5 * 1024 * 1024)) throw new Error('that file is too large (limit 8 MB, or 5 MB for images)');
      fs.mkdirSync(d.filesDir, { recursive: true });
      const filePath = path.join(d.filesDir, `${crypto.randomUUID()}${ext}`);
      fs.writeFileSync(filePath, data);
      file = { fileName: path.basename(String(b.file.name ?? `document${ext}`)).slice(0, 120), fileType: type, filePath };
    }
    return d.store.addSource({ country: country.code, scope, title, url, ...file, addedBy: who });
  }, { bodyLimit: 16 * 1024 * 1024 });

  route('post', '/admin/api/sources/:id/delete', (_who, req) => {
    const file = d.store.deleteSource(idOf(req));
    if (file) fs.rmSync(file, { force: true });
  });

  // ---- 2. Extract: read one saved source and store a draft program plus the questions it needs. ----

  route('post', '/admin/api/sources/:id/extract', async (_who, req) => {
    if (!d.complete) throw new Error('reading sources is off: set ANTHROPIC_API_KEY and restart');
    const saved = d.store.getSource(idOf(req));
    if (!saved) throw new Error('that source no longer exists');
    const country = countryOf(saved.country);
    let source: Source;
    if (saved.filePath) {
      const data = fs.readFileSync(saved.filePath);
      const type = saved.fileType ?? '';
      if (type === 'application/pdf') source = { url: saved.url, kind: 'pdf', content: data.toString('base64'), truncated: false };
      else if (type.startsWith('image/')) source = { url: saved.url, kind: 'image', mediaType: type, content: data.toString('base64'), truncated: false };
      else {
        const text = type === 'text/html' ? htmlToText(data.toString('utf8')) : data.toString('utf8').trim();
        source = { url: saved.url, kind: 'text', content: text.slice(0, 200_000), truncated: text.length > 200_000 };
      }
    } else {
      source = await (d.fetchSource ?? fetchSource)(saved.url);
    }
    const draft = await draftProgram(source, country, saved.scope, saved.title, d.complete, {
      existing: d.catalog.questions(country.code, country.languages[0]),
      check: (program, questions) => void d.catalog.check(country.code, program, saved.scope, questions),
    });
    const warnings = draft.invalid ? [`This draft does not pass the checks yet: ${draft.invalid}`, ...draft.warnings] : draft.warnings;
    const id = d.store.addDraft({ sourceId: saved.id, country: saved.country, scope: saved.scope, program: draft.program, questions: draft.questions, evidence: draft.evidence, warnings });
    return { draftId: id, found: !!draft.program };
  });

  // ---- 3. Review: edit the draft in a form, then publish it (or keep it for later, or discard it). ----

  const openDraft = (id: number) => {
    const draft = d.store.getDraft(id);
    if (!draft || draft.status !== 'open') throw new Error('that draft is no longer open');
    return draft;
  };

  route('post', '/admin/api/drafts/:id/save', (_who, req) => {
    const draft = openDraft(idOf(req));
    const b = body(req);
    d.store.updateDraft(draft.id, { program: b.program, questions: Array.isArray(b.questions) ? b.questions : draft.questions });
    try {
      d.catalog.check(draft.country, b.program, draft.scope, Array.isArray(b.questions) ? b.questions : []);
      return { problem: null };
    } catch (err) {
      return { problem: err instanceof Error ? err.message : String(err) };
    }
  });

  route('post', '/admin/api/drafts/:id/publish', (who, req) => {
    const draft = openDraft(idOf(req));
    const b = body(req);
    const questions = Array.isArray(b.questions) ? b.questions : [];
    d.store.updateDraft(draft.id, { program: b.program, questions }); // keep the edits even if a check fails below
    if (b.checked !== true) throw new Error('tick the box to confirm you checked this against the source');
    const saved = d.store.getSource(draft.sourceId);
    const changeId = d.catalog.submit({
      country: draft.country, scope: draft.scope, kind: 'upsert', raw: b.program, questions, by: who,
      note: `Drafted from source "${saved?.title ?? 'removed source'}" (${saved?.url ?? 'no link'}).`,
    });
    d.catalog.approve(changeId, who);
    d.store.updateDraft(draft.id, { status: 'published' });
    return { changeId };
  });

  route('post', '/admin/api/drafts/:id/discard', (_who, req) => d.store.updateDraft(openDraft(idOf(req)).id, { status: 'discarded' }));

  // ---- Approvals: changes that arrived another way (catalog files, or program text typed by hand). ----

  route('post', '/admin/api/changes', (who, req) => {
    const b = body(req);
    let raw: unknown;
    try {
      raw = parse(String(b.yaml ?? ''));
    } catch (err) {
      throw new Error(`the program text is not valid YAML: ${err instanceof Error ? err.message : err}`);
    }
    const country = countryOf(b.country);
    return d.catalog.submit({ country: country.code, scope: scopeOf(country, b.scope), kind: b.kind === 'remove' ? 'remove' : 'upsert', raw, note: String(b.note ?? ''), by: who });
  });

  route('post', '/admin/api/changes/:id/approve', (who, req) => {
    if (body(req).checked !== true) throw new Error('confirm that you checked this against the official source');
    d.catalog.approve(idOf(req), who);
  });

  route('post', '/admin/api/changes/:id/reject', (who, req) => d.catalog.reject(idOf(req), who, String(body(req).reason ?? '')));
}
