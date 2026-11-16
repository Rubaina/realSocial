import { describe, expect, it } from 'vitest';
import { seedPrograms } from '../src/catalog/loader';
import { draftProgram, type Complete } from '../src/extract/draft';
import { fetchSource, htmlToText, isPrivateAddress, type Source } from '../src/extract/fetch';
import { buildServer } from '../src/server';
import { setup } from './helpers';

const PUBLIC = 'http://93.184.216.34';
const page = (body: string, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } });
const reply = (data: object) => '```json\n' + JSON.stringify(data) + '\n```';
const sembako = () => structuredClone(seedPrograms().find((s) => s.raw.id === 'sembako')!.raw);
const source: Source = { url: 'https://example.go.id/program', kind: 'text', content: 'Bantuan sembako untuk keluarga miskin...', truncated: false };

describe('reading a reference page', () => {
  it('keeps the readable text of a page and drops scripts and markup', () => {
    const text = htmlToText('<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Syarat</h1><p>Keluarga &amp; anak &lt; 6 tahun</p><ul><li>KTP</li><li>KK</li></ul></body></html>');
    expect(text).toBe('Syarat\nKeluarga & anak < 6 tahun\nKTP\nKK');
  });

  it('refuses addresses on this machine or a private network', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
    const never = (async () => { throw new Error('must not be fetched'); }) as unknown as typeof fetch;
    await expect(fetchSource('http://127.0.0.1:3000/admin', never)).rejects.toThrow(/not a public website/);
    await expect(fetchSource('http://169.254.169.254/latest/meta-data', never)).rejects.toThrow(/not a public website/);
    await expect(fetchSource('file:///etc/passwd', never)).rejects.toThrow(/only http and https/);
    await expect(fetchSource('not a link', never)).rejects.toThrow(/not a valid link/);
  });

  it('does not follow a redirect into a private address', async () => {
    const http = (async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })) as unknown as typeof fetch;
    await expect(fetchSource(`${PUBLIC}/a`, http)).rejects.toThrow(/not a public website/);
  });

  it('returns page text, recognises PDFs, and reports pages with nothing to read', async () => {
    const body = `<html><body><p>${'Program bantuan untuk keluarga kurang mampu. '.repeat(10)}</p></body></html>`;
    const html = await fetchSource(`${PUBLIC}/p`, (async () => page(body)) as unknown as typeof fetch);
    expect(html).toMatchObject({ kind: 'text', truncated: false });
    expect(html.content).toContain('Program bantuan untuk keluarga kurang mampu.');
    const pdf = await fetchSource(`${PUBLIC}/doc`, (async () => page('%PDF-1.7 ...', 'application/octet-stream')) as unknown as typeof fetch);
    expect(pdf.kind).toBe('pdf');
    expect(Buffer.from(pdf.content, 'base64').toString()).toBe('%PDF-1.7 ...');
    const poster = await fetchSource(`${PUBLIC}/poster.jpg`, (async () => page('JPEGDATA', 'image/jpeg')) as unknown as typeof fetch);
    expect(poster).toMatchObject({ kind: 'image', mediaType: 'image/jpeg' });
    await expect(fetchSource(`${PUBLIC}/v.mp4`, (async () => page('x', 'video/mp4')) as unknown as typeof fetch)).rejects.toThrow(/not a web page, PDF or image/);
    await expect(fetchSource(`${PUBLIC}/empty`, (async () => page('<html><body><div id="app"></div></body></html>')) as unknown as typeof fetch)).rejects.toThrow(/upload that as the source/);
    await expect(fetchSource(`${PUBLIC}/gone`, (async () => new Response('x', { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});

describe('drafting a program and its questions from a source', () => {
  const ctx = (t: ReturnType<typeof setup>) => ({
    existing: t.catalog.questions('id', 'id'),
    check: (program: unknown, questions: unknown[]) => void t.catalog.check('id', program, [], questions as any[]),
  });
  const farmer = { id: 'is_farmer', text: { id: 'Apakah Anda petani?', en: 'Are you a farmer?' }, options: [{ value: 'yes', label: { id: 'Ya', en: 'Yes' } }, { value: 'no', label: { id: 'Tidak', en: 'No' } }] };

  it('gives the model the existing questions and offices, and returns a checked draft', async () => {
    const t = setup();
    let seen = '';
    const complete: Complete = async (_system, turns) => {
      seen = turns[0].text;
      return reply({ program: { ...sembako(), source_url: 'https://evil.example/other', last_verified: '2020-01-01' }, new_questions: [], evidence: [{ field: 'eligibility', quote: 'keluarga miskin' }], warnings: ['Waiting time is not stated.'] });
    };
    const draft = await draftProgram(source, t.countries.get('id')!, [], 'BPNT update', complete, ctx(t));
    expect(seen).toContain('- registry:');
    expect(seen).toContain('- kelurahan:');
    expect(seen).toContain('"id", "en"');
    expect(seen).toContain('A new question has this format');
    expect(seen).toContain('Bantuan sembako untuk keluarga miskin');
    expect(draft.invalid).toBeNull();
    expect(draft.program.source_url).toBe('https://example.go.id/program');   // always the source that was read
    expect(draft.program.last_verified).toBeUndefined();                     // only approval sets this
    expect(draft.questions).toEqual([]);
    expect(draft.evidence).toEqual([{ field: 'eligibility', quote: 'keluarga miskin' }]);
    expect(draft.warnings).toEqual(['Waiting time is not stated.']);
  });

  it('accepts a new question the program needs, and uses it in the rule', async () => {
    const t = setup();
    const program = { ...sembako(), id: 'pupuk', eligibility: { fact: 'is_farmer', in: ['yes'] } };
    const draft = await draftProgram(source, t.countries.get('id')!, [], '', async () => reply({ program, new_questions: [farmer], evidence: [], warnings: [] }), ctx(t));
    expect(draft.invalid).toBeNull();
    expect(draft.questions).toEqual([farmer]);
  });

  it('asks for one correction when the draft fails the catalog check', async () => {
    const t = setup();
    const bad = { ...sembako(), eligibility: { fact: 'is_farmer', in: ['yes'] } };   // uses a question it did not define
    const replies = [reply({ program: bad, new_questions: [], evidence: [], warnings: [] }), reply({ program: bad, new_questions: [farmer], evidence: [], warnings: [] })];
    const asked: string[] = [];
    const complete: Complete = async (_s, turns) => { asked.push(turns.at(-1)!.text); return replies.shift()!; };
    const draft = await draftProgram(source, t.countries.get('id')!, [], '', complete, ctx(t));
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatch(/fails the catalog check.*is_farmer/s);
    expect(draft.invalid).toBeNull();
  });

  it('passes a poster image to the model as an attachment', async () => {
    const t = setup();
    let got: unknown;
    const complete: Complete = async (_s, turns, attachment) => { got = { attachment, text: turns[0].text }; return reply({ program: sembako(), evidence: [], warnings: [] }); };
    await draftProgram({ url: 'https://example.go.id/poster.jpg', kind: 'image', mediaType: 'image/jpeg', content: 'QUJD', truncated: false }, t.countries.get('id')!, [], '', complete, ctx(t));
    expect(got).toMatchObject({ attachment: { kind: 'image', mediaType: 'image/jpeg', data: 'QUJD' } });
    expect((got as { text: string }).text).toContain('attached image');
  });

  it('hands back a still-invalid draft clearly marked, and says when a source has no program', async () => {
    const t = setup();
    const bad = sembako();
    delete bad.title.en;
    const stuck = await draftProgram(source, t.countries.get('id')!, [], '', async () => reply({ program: bad, evidence: [], warnings: [] }), ctx(t));
    expect(stuck.invalid).toMatch(/title/);
    expect(stuck.program.id).toBe('sembako');

    const none = await draftProgram({ ...source, truncated: true }, t.countries.get('id')!, [], '', async () => reply({ program: null, evidence: [], warnings: ['This is a news article about road works.'] }), ctx(t));
    expect(none.program).toBeNull();
    expect(none.warnings[0]).toMatch(/only the first part was read/);
    await expect(draftProgram(source, t.countries.get('id')!, [], '', async () => 'I cannot help', ctx(t))).rejects.toThrow(/could not be read/);
  });
});

describe('admin: sources, drafts, publish', () => {
  const headers = { authorization: `Basic ${Buffer.from('Ruby:tok').toString('base64')}`, 'content-type': 'application/json' };
  const ID = '6281234567890';
  const client = (app: ReturnType<typeof buildServer>) => ({
    post: async (url: string, body: object = {}) => { const r = await app.inject({ method: 'POST', url, headers, payload: JSON.stringify(body) }); return { status: r.statusCode, ...r.json() }; },
    state: async () => (await app.inject({ url: '/admin/api/state', headers })).json().result,
  });
  const farmer = { id: 'is_farmer', text: { id: 'Apakah Anda petani?', en: 'Are you a farmer?' }, options: [{ value: 'yes', label: { id: 'Ya', en: 'Yes' } }, { value: 'no', label: { id: 'Tidak', en: 'No' } }] };
  const pupuk = () => ({ ...sembako(), id: 'pupuk', title: { id: 'Pupuk bersubsidi', en: 'Subsidised fertiliser' }, priority: 99, eligibility: { fact: 'is_farmer', in: ['yes'] } });

  it('saves a source without reading it, and checks what is entered', async () => {
    const t = setup();
    let reads = 0;
    const api = client(buildServer({ admin: t.admin({ complete: async () => { reads++; return reply({ program: null, evidence: [], warnings: [] }); }, fetchSource: async (url) => ({ ...source, url }) }) }));
    expect((await api.post('/admin/api/sources', { country: 'id', scope: 'jawa-timur/surabaya', title: '', url: 'https://x.go.id' })).error).toMatch(/short name/);
    expect((await api.post('/admin/api/sources', { country: 'id', scope: 'mars', title: 'A', url: 'https://x.go.id' })).error).toMatch(/region/);
    expect((await api.post('/admin/api/sources', { country: 'id', scope: '', title: 'A', url: 'ftp://x' })).error).toMatch(/web address/);
    expect((await api.post('/admin/api/sources', { country: 'zz', scope: '', title: 'A', url: 'https://x.go.id' })).error).toMatch(/country/);

    const saved = await api.post('/admin/api/sources', { country: 'id', scope: 'jawa-timur/surabaya', title: 'Dinsos poster', url: 'https://dinsos.example.go.id/poster.jpg' });
    expect(saved.status).toBe(200);
    const state = await api.state();
    expect(state.sources).toMatchObject([{ title: 'Dinsos poster', country: 'id', scope: ['jawa-timur', 'surabaya'], addedBy: 'Ruby', openDrafts: 0 }]);
    expect(state.countries.find((c: any) => c.code === 'id').regions).toContainEqual({ path: 'jawa-timur/surabaya', name: 'East Java / Surabaya City' });
    expect(reads).toBe(0);
    expect(state.drafts).toEqual([]);
  });

  it('keeps an uploaded document and reads it, not the link, when drafting', async () => {
    const t = setup();
    let attachment: unknown;
    const deps = t.admin({ complete: async (_s, _t, a) => { attachment = a; return reply({ program: null, evidence: [], warnings: ['No program.'] }); }, fetchSource: async () => { throw new Error('must not fetch the link'); } });
    const api = client(buildServer({ admin: deps }));
    const pdf = Buffer.from('%PDF-1.7 fake').toString('base64');
    expect((await api.post('/admin/api/sources', { country: 'id', scope: '', title: 'Decree', url: 'https://x.go.id/sk', file: { name: 'virus.exe', type: 'application/x-msdownload', data: pdf } })).error).toMatch(/kind of file/);
    expect((await api.post('/admin/api/sources', { country: 'id', scope: '', title: 'Decree', url: '', file: { name: 'sk.pdf', type: 'application/pdf', data: pdf } })).error).toMatch(/came from/);
    const saved = await api.post('/admin/api/sources', { country: 'id', scope: '', title: 'Decree', url: 'https://x.go.id/sk', file: { name: '../../sk.pdf', type: 'application/pdf', data: pdf } });
    const stored = t.store.getSource(saved.result)!;
    expect(stored.fileName).toBe('sk.pdf');
    expect(stored.filePath!.startsWith(deps.filesDir)).toBe(true);

    const read = await api.post(`/admin/api/sources/${saved.result}/extract`);
    expect(read.result).toMatchObject({ found: false });
    expect(attachment).toMatchObject({ kind: 'pdf', data: pdf });
    expect((await api.state()).drafts).toMatchObject([{ program: null, warnings: ['No program.'], sourceTitle: 'Decree', sourceFile: 'sk.pdf' }]);
  });

  it('turns a source into a draft, lets it be edited, and publishes program and question together', async () => {
    const t = setup();
    const api = client(buildServer({ admin: t.admin({
      fetchSource: async (url) => ({ ...source, url }),
      complete: async () => reply({ program: pupuk(), new_questions: [farmer], evidence: [{ field: 'eligibility', quote: 'untuk petani' }], warnings: ['Check the quota.'] }),
    }) }));
    const src = await api.post('/admin/api/sources', { country: 'id', scope: '', title: 'Fertiliser page', url: 'https://pertanian.example.go.id/pupuk' });
    const { draftId } = (await api.post(`/admin/api/sources/${src.result}/extract`)).result;
    const [draft] = (await api.state()).drafts;
    expect(draft).toMatchObject({ id: draftId, sourceTitle: 'Fertiliser page', questions: [farmer], warnings: ['Check the quota.'] });
    expect(draft.program.source_url).toBe('https://pertanian.example.go.id/pupuk');

    // Nothing is live yet: the bot neither offers the program nor asks the new question.
    expect(t.catalog.programs('id', 'id').some((p) => p.id === 'pupuk')).toBe(false);
    expect(t.catalog.questions('id', 'id').some((q) => q.id === 'is_farmer')).toBe(false);

    // Saving for later reports what still fails, without publishing.
    const tooLong = { ...draft.program, title: { id: 'Pupuk bersubsidi untuk semua petani kecil', en: 'Subsidised fertiliser' } };
    expect((await api.post(`/admin/api/drafts/${draftId}/save`, { program: tooLong, questions: draft.questions })).result.problem).toMatch(/title/);
    expect((await api.post(`/admin/api/drafts/${draftId}/publish`, { program: tooLong, questions: draft.questions, checked: true })).error).toMatch(/title/);
    expect((await api.post(`/admin/api/drafts/${draftId}/publish`, { program: draft.program, questions: draft.questions })).error).toMatch(/tick the box/);

    const edited = { ...draft.program, benefit: { id: 'Pupuk lebih murah untuk petani', en: 'Cheaper fertiliser for farmers' } };
    expect((await api.post(`/admin/api/drafts/${draftId}/publish`, { program: edited, questions: draft.questions, checked: true })).status).toBe(200);

    const state = await api.state();
    expect(state.drafts).toEqual([]);
    expect(state.live.find((p: any) => p.programId === 'pupuk')).toMatchObject({ title: 'Subsidised fertiliser', approvedBy: 'Ruby', verified: '2026-11-15' });
    expect(state.countries.find((c: any) => c.code === 'id').questions.some((q: any) => q.id === 'is_farmer')).toBe(true);
    expect(t.catalog.programs('id', 'en').find((p) => p.id === 'pupuk')!.benefit).toBe('Cheaper fertiliser for farmers');
    expect(t.store.changes('approved').at(-1)).toMatchObject({ programId: 'pupuk', submittedBy: 'Ruby', reviewedBy: 'Ruby', note: expect.stringContaining('Fertiliser page') });

    // The bot now asks the new question, in the person's language, and offers the program.
    const c = t.chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    await c.tap('Mulai');
    await c.tap('Provinsi lain');
    const asked = await c.answer({ registry: 'no', income: 'gt4', power: '1300', is_farmer: 'yes' });
    expect(asked).toContain('is_farmer');
    expect(c.titles()[0]).toBe('Pupuk bersubsidi');
  });

  it('discards a draft, removes a source, and refuses to read when model access is off', async () => {
    const t = setup();
    const api = client(buildServer({ admin: t.admin({ fetchSource: async (url) => ({ ...source, url }), complete: async () => reply({ program: pupuk(), new_questions: [farmer], evidence: [], warnings: [] }) }) }));
    const src = await api.post('/admin/api/sources', { country: 'id', scope: '', title: 'Page', url: 'https://x.go.id/p' });
    const first = (await api.post(`/admin/api/sources/${src.result}/extract`)).result.draftId;
    expect((await api.post(`/admin/api/drafts/${first}/discard`)).status).toBe(200);
    expect((await api.post(`/admin/api/drafts/${first}/publish`, { checked: true })).error).toMatch(/no longer open/);
    await api.post(`/admin/api/sources/${src.result}/extract`);
    expect((await api.state()).drafts).toHaveLength(1);
    await api.post(`/admin/api/sources/${src.result}/delete`);
    expect(await api.state()).toMatchObject({ sources: [], drafts: [] });

    const off = client(buildServer({ admin: t.admin() }));
    const s2 = await off.post('/admin/api/sources', { country: 'id', scope: '', title: 'Page', url: 'https://x.go.id/p' });
    expect((await off.post(`/admin/api/sources/${s2.result}/extract`)).error).toMatch(/ANTHROPIC_API_KEY/);
    expect((await off.state()).canExtract).toBe(false);
    expect((await buildServer({ admin: t.admin() }).inject({ method: 'POST', url: '/admin/api/sources', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(401);
  });
});
