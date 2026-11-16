import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Loaded through require so bundlers/test runners do not try to resolve the built-in module themselves.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export interface User {
  phone: string;
  country: string;
  lang: string;
  region: string[];
  facts: Record<string, string>;
  session: any;
  firstSeen: string;
  lastSeen: string;
}

export interface EventRow {
  phone: string;
  type: string;
  programId: string | null;
  data: any;
  createdAt: string;
}

export type ChangeStatus = 'pending' | 'approved' | 'rejected';

/** A proposed new program, edit, or removal. Only approved changes are ever shown to people. */
export interface SavedSource {
  id: number;
  country: string;
  scope: string[];
  title: string;
  /** The official web address. For an uploaded file, where the document came from. */
  url: string;
  fileName: string | null;
  fileType: string | null;
  filePath: string | null;
  addedBy: string;
  addedAt: string;
}

/** What was extracted from one source, kept so the reviewer can check and edit it before publishing. */
export interface DraftRow {
  id: number;
  sourceId: number;
  country: string;
  scope: string[];
  program: any | null;
  questions: any[];
  evidence: { field: string; quote: string }[];
  warnings: string[];
  status: 'open' | 'published' | 'discarded';
  createdAt: string;
  updatedAt: string;
}

export interface Change {
  id: number;
  country: string;
  programId: string;
  scope: string[];
  kind: 'upsert' | 'remove';
  data: any;
  /** New questions this program needs. They go live together with it. */
  questions: any[];
  note: string;
  status: ChangeStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

const toChange = (r: any): Change => ({
  id: r.id, country: r.country, programId: r.program_id, scope: JSON.parse(r.scope), kind: r.kind,
  data: JSON.parse(r.data), questions: r.questions ? JSON.parse(r.questions) : [], note: r.note, status: r.status, submittedBy: r.submitted_by, submittedAt: r.submitted_at,
  reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
});

/**
 * Users, the programs each was shown, tracking events, and the program review queue.
 * Plain SQL that also runs on Postgres with minor type changes.
 */
export class Store {
  private db: any;

  constructor(file = ':memory:', readonly now: () => Date = () => new Date()) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY, country TEXT NOT NULL, lang TEXT NOT NULL, region TEXT NOT NULL, facts TEXT NOT NULL,
        session TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, program_id TEXT NOT NULL,
        reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, type TEXT NOT NULL,
        program_id TEXT, data TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS program_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT NOT NULL, program_id TEXT NOT NULL, scope TEXT NOT NULL,
        kind TEXT NOT NULL, data TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL,
        submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
        reviewed_by TEXT, reviewed_at TEXT, review_note TEXT);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT NOT NULL, scope TEXT NOT NULL, title TEXT NOT NULL,
        url TEXT NOT NULL, file_name TEXT, file_type TEXT, file_path TEXT, added_by TEXT NOT NULL, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, country TEXT NOT NULL, scope TEXT NOT NULL,
        program TEXT, questions TEXT NOT NULL, evidence TEXT NOT NULL, warnings TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_phone ON events (phone, type);
    `);
    // Databases created before questions could be proposed lack this column.
    const columns = this.db.prepare('PRAGMA table_info(program_changes)').all().map((c: any) => c.name);
    if (!columns.includes('questions')) this.db.exec('ALTER TABLE program_changes ADD COLUMN questions TEXT');
  }

  private stamp = () => this.now().toISOString();

  // ---- people ---------------------------------------------------------------------------------

  getUser(phone: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!r) return null;
    return {
      phone: r.phone, country: r.country, lang: r.lang, region: JSON.parse(r.region), facts: JSON.parse(r.facts),
      session: JSON.parse(r.session), firstSeen: r.first_seen, lastSeen: r.last_seen,
    };
  }

  saveUser(u: User): void {
    u.lastSeen = this.stamp();
    this.db
      .prepare(
        `INSERT INTO users (phone, country, lang, region, facts, session, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (phone) DO UPDATE SET country = excluded.country, lang = excluded.lang, region = excluded.region,
           facts = excluded.facts, session = excluded.session, last_seen = excluded.last_seen`,
      )
      .run(u.phone, u.country, u.lang, JSON.stringify(u.region), JSON.stringify(u.facts), JSON.stringify(u.session), u.firstSeen, u.lastSeen);
  }

  addEvent(phone: string, type: string, programId: string | null = null, data: unknown = null): void {
    this.db
      .prepare('INSERT INTO events (phone, type, program_id, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(phone, type, programId, data === null ? null : JSON.stringify(data), this.stamp());
  }

  events(phone: string): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE phone = ? ORDER BY id')
      .all(phone)
      .map((r: any) => ({ phone: r.phone, type: r.type, programId: r.program_id, data: r.data ? JSON.parse(r.data) : null, createdAt: r.created_at }));
  }

  /** Replaces the person's current result list (it is recomputed whenever their answers change). */
  saveResults(phone: string, results: { programId: string; reason: unknown }[]): void {
    this.db.prepare('DELETE FROM results WHERE phone = ?').run(phone);
    const insert = this.db.prepare('INSERT INTO results (phone, program_id, reason, created_at) VALUES (?, ?, ?, ?)');
    for (const r of results) insert.run(phone, r.programId, JSON.stringify(r.reason), this.stamp());
  }

  results(phone: string): { programId: string; reason: any }[] {
    return this.db
      .prepare('SELECT program_id, reason FROM results WHERE phone = ? ORDER BY id')
      .all(phone)
      .map((r: any) => ({ programId: r.program_id, reason: JSON.parse(r.reason) }));
  }

  /** Removes every row about this person. */
  deleteUser(phone: string): void {
    for (const table of ['users', 'results', 'events']) this.db.prepare(`DELETE FROM ${table} WHERE phone = ?`).run(phone);
  }

  // ---- program review queue ---------------------------------------------------------------------

  addChange(c: Pick<Change, 'country' | 'programId' | 'scope' | 'kind' | 'data' | 'note' | 'submittedBy'> & { questions?: any[] }): number {
    const r = this.db
      .prepare(
        `INSERT INTO program_changes (country, program_id, scope, kind, data, questions, note, status, submitted_by, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(c.country, c.programId, JSON.stringify(c.scope), c.kind, JSON.stringify(c.data), JSON.stringify(c.questions ?? []), c.note, c.submittedBy, this.stamp());
    return Number(r.lastInsertRowid);
  }

  getChange(id: number): Change | null {
    const r = this.db.prepare('SELECT * FROM program_changes WHERE id = ?').get(id);
    return r ? toChange(r) : null;
  }

  changes(status: ChangeStatus): Change[] {
    return this.db.prepare('SELECT * FROM program_changes WHERE status = ? ORDER BY id').all(status).map(toChange);
  }

  /** The most recent proposal for a program, whatever its status; optionally only those from one submitter. */
  latestChange(country: string, programId: string, submittedBy?: string): Change | null {
    const r = submittedBy === undefined
      ? this.db.prepare('SELECT * FROM program_changes WHERE country = ? AND program_id = ? ORDER BY id DESC LIMIT 1').get(country, programId)
      : this.db.prepare('SELECT * FROM program_changes WHERE country = ? AND program_id = ? AND submitted_by = ? ORDER BY id DESC LIMIT 1').get(country, programId, submittedBy);
    return r ? toChange(r) : null;
  }

  /** What people can see: for each program, its newest approved version, unless that version removed it. */
  liveChanges(): Change[] {
    return this.db
      .prepare(
        `SELECT * FROM program_changes WHERE kind = 'upsert' AND id IN
           (SELECT MAX(id) FROM program_changes WHERE status = 'approved' GROUP BY country, program_id)
         ORDER BY id`,
      )
      .all()
      .map(toChange);
  }

  /** Records the reviewer's decision. Returns false if the change was not pending any more. */
  reviewChange(id: number, status: 'approved' | 'rejected', by: string, note: string | null, data?: unknown): boolean {
    const r = this.db
      .prepare(
        `UPDATE program_changes SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, data = COALESCE(?, data)
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, by, this.stamp(), note, data === undefined ? null : JSON.stringify(data), id);
    if (r.changes && status === 'approved') {
      this.db.prepare(`INSERT INTO meta (key, value) VALUES ('catalog_version', '1')
        ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`).run();
    }
    return r.changes > 0;
  }

  /** Changes whenever the set of approved programs changes, so other processes know to reload. */
  catalogVersion(): number {
    return Number(this.db.prepare(`SELECT value FROM meta WHERE key = 'catalog_version'`).get()?.value ?? 0);
  }

  // ---- saved sources and drafts ----------------------------------------------------------------

  addSource(s: Omit<SavedSource, 'id' | 'addedAt'>): number {
    const r = this.db
      .prepare('INSERT INTO sources (country, scope, title, url, file_name, file_type, file_path, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.country, JSON.stringify(s.scope), s.title, s.url, s.fileName, s.fileType, s.filePath, s.addedBy, this.stamp());
    return Number(r.lastInsertRowid);
  }

  private toSource = (r: any): SavedSource => ({
    id: r.id, country: r.country, scope: JSON.parse(r.scope), title: r.title, url: r.url, fileName: r.file_name,
    fileType: r.file_type, filePath: r.file_path, addedBy: r.added_by, addedAt: r.added_at,
  });

  sources(): SavedSource[] {
    return this.db.prepare('SELECT * FROM sources ORDER BY id DESC').all().map(this.toSource);
  }

  getSource(id: number): SavedSource | null {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    return r ? this.toSource(r) : null;
  }

  /** Removes a source and its unpublished drafts. Returns the stored file to delete, if any. */
  deleteSource(id: number): string | null {
    const source = this.getSource(id);
    this.db.prepare(`UPDATE drafts SET status = 'discarded' WHERE source_id = ? AND status = 'open'`).run(id);
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    return source?.filePath ?? null;
  }

  addDraft(d: Pick<DraftRow, 'sourceId' | 'country' | 'scope' | 'program' | 'questions' | 'evidence' | 'warnings'>): number {
    const now = this.stamp();
    const r = this.db
      .prepare(`INSERT INTO drafts (source_id, country, scope, program, questions, evidence, warnings, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
      .run(d.sourceId, d.country, JSON.stringify(d.scope), d.program ? JSON.stringify(d.program) : null, JSON.stringify(d.questions), JSON.stringify(d.evidence), JSON.stringify(d.warnings), now, now);
    return Number(r.lastInsertRowid);
  }

  private toDraft = (r: any): DraftRow => ({
    id: r.id, sourceId: r.source_id, country: r.country, scope: JSON.parse(r.scope), program: r.program ? JSON.parse(r.program) : null,
    questions: JSON.parse(r.questions), evidence: JSON.parse(r.evidence), warnings: JSON.parse(r.warnings), status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  });

  openDrafts(): DraftRow[] {
    return this.db.prepare(`SELECT * FROM drafts WHERE status = 'open' ORDER BY id DESC`).all().map(this.toDraft);
  }

  getDraft(id: number): DraftRow | null {
    const r = this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
    return r ? this.toDraft(r) : null;
  }

  updateDraft(id: number, d: { program?: any; questions?: any[]; status?: DraftRow['status'] }): void {
    const cur = this.getDraft(id);
    if (!cur) return;
    this.db
      .prepare('UPDATE drafts SET program = ?, questions = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(d.program ?? cur.program), JSON.stringify(d.questions ?? cur.questions), d.status ?? cur.status, this.stamp(), id);
  }

  close(): void {
    this.db.close();
  }
}
