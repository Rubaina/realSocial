import { describe, expect, it } from 'vitest';
import { seedPrograms } from '../src/catalog/loader';
import { buildServer } from '../src/server';
import { setup, toSurabayaResults } from './helpers';

const ID = '6281234567890';
const sembako = () => structuredClone(seedPrograms().find((s) => s.raw.id === 'sembako')!.raw);

describe('nothing reaches people without approval', () => {
  it('starts with every program pending and none shown', async () => {
    const t = setup({ approve: false });
    expect(t.catalog.pending()).toHaveLength(13);
    expect(t.catalog.programs('id', 'id')).toEqual([]);
    const c = t.chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    await c.tap('Mulai');
    await c.tap('Jawa Timur');
    await c.tap('Kota Surabaya');
    expect(c.body()).toContain('belum menemukan bantuan');   // no questions asked, no programs offered
  });

  it('shows a program only after it is approved', async () => {
    const t = setup({ approve: false });
    const change = t.catalog.pending().find((p) => p.change.programId === 'sembako')!.change;
    t.catalog.approve(change.id, 'Reviewer');
    expect(t.catalog.programs('id', 'id').map((p) => p.id)).toEqual(['sembako']);
    expect(t.catalog.programs('id', 'en').map((p) => p.title)).toEqual(['Food aid (BPNT)']);
    expect(t.store.getChange(change.id)).toMatchObject({ status: 'approved', reviewedBy: 'Reviewer' });
    expect(() => t.catalog.approve(change.id, 'Reviewer')).toThrow(/already reviewed/);
  });

  it('keeps the live version until an edit is approved, and drops a rejected edit', async () => {
    const t = setup();
    const edited = sembako();
    edited.benefit = { id: 'Bantuan Rp200.000 per bulan untuk bahan makanan', en: 'Rp200,000 a month to buy basic food' };
    const id = t.catalog.submit({ country: 'id', scope: [], kind: 'upsert', raw: edited, note: 'Amount announced on kemensos.go.id', by: 'Team member' });
    const benefit = () => t.catalog.programs('id', 'id').find((p) => p.id === 'sembako')!.benefit;

    expect(benefit()).toBe('Bantuan rutin untuk membeli bahan makanan');
    expect(t.catalog.pending()).toMatchObject([{ change: { id, submittedBy: 'Team member' }, changedFields: ['benefit'] }]);
    t.catalog.reject(id, 'Reviewer', 'Amount not confirmed on the official site');
    expect(benefit()).toBe('Bantuan rutin untuk membeli bahan makanan');

    const second = t.catalog.submit({ country: 'id', scope: [], kind: 'upsert', raw: edited, note: 'Confirmed', by: 'Team member' });
    t.catalog.approve(second, 'Reviewer');
    expect(benefit()).toBe('Bantuan Rp200.000 per bulan untuk bahan makanan');
  });

  it('removes a program only after the removal is approved, even for someone reading it', async () => {
    const t = setup();
    const c = t.chat(ID);
    await toSurabayaResults(c);
    await c.tap('Bantuan sembako (BPNT)');
    const id = t.catalog.submit({ country: 'id', scope: [], kind: 'remove', raw: { id: 'sembako' }, note: 'Program ended', by: 'Team member' });
    expect(t.catalog.programs('id', 'id').some((p) => p.id === 'sembako')).toBe(true);
    t.catalog.approve(id, 'Reviewer');
    expect(t.catalog.programs('id', 'id').some((p) => p.id === 'sembako')).toBe(false);
    await c.tap('Cara daftar');
    expect(c.titles()).not.toContain('Bantuan sembako (BPNT)');
    expect(c.titles()).toContain('KIP Kuliah');
  });

  it('does not re-propose a file after the program was edited on the review page', () => {
    const t = setup();
    const edited = sembako();
    edited.priority = 81;
    t.catalog.submit({ country: 'id', scope: [], kind: 'upsert', raw: edited, note: 'Reordered', by: 'Ruby' });
    expect(t.catalog.importSeeds(seedPrograms())).toBe(0);
    expect(t.catalog.pending().map((p) => p.change.submittedBy)).toEqual(['Ruby']);
  });

  it('refuses malformed proposals and does not re-propose unchanged files', () => {
    const t = setup();
    const bad = sembako();
    delete bad.benefit.en;
    expect(() => t.catalog.submit({ country: 'id', scope: [], kind: 'upsert', raw: bad, note: 'x', by: 'a' })).toThrow(/benefit/);
    expect(() => t.catalog.submit({ country: 'id', scope: [], kind: 'upsert', raw: sembako(), note: ' ', by: 'a' })).toThrow(/note/);
    expect(() => t.catalog.submit({ country: 'id', scope: [], kind: 'remove', raw: { id: 'nope' }, note: 'x', by: 'a' })).toThrow(/not live/);
    expect(t.catalog.importSeeds(seedPrograms())).toBe(0);
    expect(t.catalog.pending()).toEqual([]);
  });
});

describe('review page', () => {
  const auth = (name: string, password: string) => ({ authorization: `Basic ${Buffer.from(`${name}:${password}`).toString('base64')}` });
  const json = { 'content-type': 'application/json' };

  it('needs the password, lists pending items, and records who approved', async () => {
    const t = setup({ approve: false });
    const app = buildServer({ admin: t.admin({ token: 's3cret-token' }) });

    expect((await app.inject({ url: '/admin' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/admin/api/state', headers: auth('Ruby', 'wrong') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin/api/changes/1/approve', headers: json, payload: '{"checked":true}' })).statusCode).toBe(401);

    const page = await app.inject({ url: '/admin', headers: auth('Ruby', 's3cret-token') });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('realSocial admin');

    const state = (await app.inject({ url: '/admin/api/state', headers: auth('Ruby', 's3cret-token') })).json().result;
    expect(state.pending).toHaveLength(13);
    const item = state.pending.find((p: any) => p.programId === 'sby_uhc');
    expect(item.proposed).toContain('Berobat gratis pakai KTP');

    const post = (url: string, body: object) => app.inject({ method: 'POST', url, headers: { ...json, ...auth('Ruby', 's3cret-token') }, payload: JSON.stringify(body) });
    const unchecked = await post(`/admin/api/changes/${item.id}/approve`, {});
    expect(unchecked.statusCode).toBe(400);
    expect(t.catalog.programs('id', 'id')).toEqual([]);

    expect((await post(`/admin/api/changes/${item.id}/approve`, { checked: true })).statusCode).toBe(200);
    expect(t.catalog.programs('id', 'id').map((p) => p.id)).toEqual(['sby_uhc']);
    expect(t.store.getChange(item.id)!.reviewedBy).toBe('Ruby');

    const other = state.pending.find((p: any) => p.programId === 'pkh');
    expect((await post(`/admin/api/changes/${other.id}/reject`, { reason: '' })).statusCode).toBe(400);
    expect((await post(`/admin/api/changes/${other.id}/reject`, { reason: 'Steps unclear' })).statusCode).toBe(200);
    expect(t.store.getChange(other.id)).toMatchObject({ status: 'rejected', reviewNote: 'Steps unclear' });
  });

  it('saves a manually entered update as pending, not live', async () => {
    const t = setup();
    const app = buildServer({ admin: t.admin() });
    const post = (body: object) => app.inject({ method: 'POST', url: '/admin/api/changes', headers: { ...json, ...auth('Ruby', 'tok') }, payload: JSON.stringify(body) });
    const yaml = `id: sample_ration\ntitle: "Sample: food ration"\nbenefit: Updated sample benefit\nwhy: Low family income.\npriority: 40\neligibility: { fact: income, in: [low] }\nhow_to_apply:\n  online:\n    url: https://www.myscheme.gov.in\n    steps: [Open the website]\nsource_url: https://www.myscheme.gov.in\n`;

    expect((await post({ country: 'in', scope: '', note: '', yaml })).json().error).toMatch(/note/);
    expect((await post({ country: 'in', scope: '', note: 'x', yaml: 'id: [' })).json().error).toMatch(/YAML/);
    expect((await post({ country: 'in', scope: 'nowhere', note: 'x', yaml })).json().error).toMatch(/region/);
    expect((await post({ country: 'in', scope: '', note: 'x', yaml: '' })).json().error).toMatch(/no program to save yet/);

    expect((await post({ country: 'in', scope: '', note: 'Rule changed, see myscheme.gov.in', yaml })).statusCode).toBe(200);
    expect(t.catalog.pending()).toMatchObject([{ change: { programId: 'sample_ration', submittedBy: 'Ruby' }, changedFields: expect.arrayContaining(['benefit', 'eligibility']) }]);
    expect(t.catalog.programs('in', 'en').find((p) => p.id === 'sample_ration')!.benefit).not.toBe('Updated sample benefit');
  });
});
