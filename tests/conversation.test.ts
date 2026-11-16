import { describe, expect, it } from 'vitest';
import { loadCountries } from '../src/catalog/loader';
import { setup, toSurabayaResults } from './helpers';

const ID = '6281234567890';
const IN = '919812345678';

describe('finding support', () => {
  it('takes a Surabaya family from hello to a checklist they can act on', async () => {
    const t = setup();
    const c = t.chat(ID);
    const asked = await toSurabayaResults(c);

    // Being in the registry already settles the "low income" rules, so income is never asked.
    expect(asked).not.toContain('income');
    expect(c.titles()).toEqual([
      '1 Keluarga 1 Sarjana', 'Berobat gratis pakai KTP', 'KIP Kuliah', 'BPJS Kesehatan gratis', 'Bantuan sembako (BPNT)', 'Mulai ulang', 'Ganti bahasa',
    ]);

    await c.tap('1 Keluarga 1 Sarjana');
    expect(c.body()).toContain('Pemkot Surabaya membiayai satu anak');
    await c.tap('Cara daftar');
    const steps = c.last[0].body;
    expect(steps).toContain('Kantor kelurahan di Surabaya');
    expect(steps).toContain('KTP Surabaya');
    expect(steps).toContain('1. Tanya ke petugas');
    expect(steps).toContain('surabaya.go.id');
    expect(steps).not.toContain('⚠️');           // approved today, so no "check first" warning

    // No upload: the person only confirms they have the documents.
    expect(c.titles()).toEqual(['Sudah punya', 'Belum']);
    await c.tap('Sudah punya');
    expect(c.titles()).toEqual(['Sudah daftar', 'Program lain', 'Selesai']);
    await c.tap('Sudah daftar');

    expect(t.store.events(ID).map((e) => e.type)).toEqual([
      'started', 'language_set', 'region_set', 'profile_completed', 'results_shown', 'program_picked', 'steps_sent',
      'documents_confirmed', 'self_reported_applied', 'results_shown',
    ]);
    const user = t.store.getUser(ID)!;
    expect(user).toMatchObject({ lang: 'id', region: ['jawa-timur', 'surabaya'] });
    expect(t.store.results(ID).find((r) => r.programId === 'kip_kuliah')!.reason).toEqual({ college_bound: 'yes', registry: 'yes' });
  });

  it('names the operator in the first message', async () => {
    const c = setup().chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    expect(c.body()).toContain('Selamat datang di Test Operator');
  });

  it('offers both routes, and helps when a document is missing', async () => {
    const t = setup();
    const c = t.chat(ID);
    await toSurabayaResults(c);
    await c.tap('KIP Kuliah');
    await c.tap('Cara daftar');
    expect(c.titles()).toEqual(['Datang langsung', 'Daftar online', 'Kembali']);
    await c.tap('Daftar online');
    expect(c.last[0].body).toContain('https://kip-kuliah.kemdiktisaintek.go.id');
    expect(c.last[0].body).toContain('NISN');
    await c.tap('Belum');
    expect(c.last[0].body).toContain('Tidak apa-apa');
    expect(t.store.events(ID).at(-1)).toMatchObject({ type: 'documents_missing', programId: 'kip_kuliah' });
  });

  it('does not show Surabaya programs elsewhere, and says so when nothing matches', async () => {
    const c = setup().chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    await c.tap('Mulai');
    await c.tap('Provinsi lain');
    const asked = await c.answer({ registry: 'no', income: 'gt4', power: '1300' });
    expect(asked).toEqual(['registry', 'income', 'power']);
    expect(c.body()).toContain('belum menemukan bantuan');
  });
});

describe('languages', () => {
  it('asks for the language first, in both languages', async () => {
    const c = setup().chat(ID);
    await c.say('hello');
    expect(c.body()).toContain('Pilih bahasa Anda.');
    expect(c.body()).toContain('Choose your language.');
    expect(c.titles()).toEqual(['Bahasa Indonesia', 'English']);
    await c.tap('English');
    expect(c.body()).toContain('government support');
    expect(c.titles()).toEqual(['Start', 'Change language', 'Change country']);
  });

  it('runs the whole flow in English, including program text', async () => {
    const c = setup().chat(ID);
    await c.say('hello');
    await c.tap('English');
    await c.tap('Start');
    await c.tap('East Java');
    await c.tap('Surabaya City');
    await c.answer({ ktp_surabaya: 'yes', registry: 'yes', school_child: 'no', college_bound: 'yes', pregnant_toddler: 'no', elderly: 'no', disability: 'no', bpjs: 'no', power: '1300', work: 'employee' });
    expect(c.titles().slice(0, 3)).toEqual(['1 Family 1 Graduate', 'Free care with your KTP', 'KIP Kuliah scholarship']);
    await c.tap('Free care with your KTP');
    await c.tap('How to apply');
    expect(c.last[0].body).toContain('Nearest community health centre (puskesmas) in Surabaya');
    expect(c.last[0].body).toContain('Go to the registration desk');
    expect(c.titles()).toEqual(['I have them', 'Not yet']);
  });

  it('switches language later without losing answers', async () => {
    const t = setup();
    const c = t.chat(ID);
    await toSurabayaResults(c);
    await c.say('ganti bahasa');
    await c.tap('English');
    expect(c.titles()).toContain('1 Family 1 Graduate');   // straight back to results, now in English
    expect(t.store.getUser(ID)).toMatchObject({ lang: 'en', facts: { registry: 'yes' } });
    await c.tap('Change language');
    await c.tap('Bahasa Indonesia');
    expect(c.titles()).toContain('1 Keluarga 1 Sarjana');
  });
});

describe('ways of answering', () => {
  it('accepts a typed number, the option words, and a voice note', async () => {
    const t = setup();
    const c = t.chat(ID);
    await c.say('halo');
    await c.say('1');                       // Bahasa Indonesia
    await c.say('mulai');
    await c.say('jawa timur');
    await c.voice('kota surabaya');
    expect(c.body()).toContain('KTP Surabaya');
    await c.voice('iya');
    expect(t.store.getUser(ID)!.facts).toEqual({ ktp_surabaya: 'yes' });
  });

  it('re-shows the options when it does not understand, without changing anything', async () => {
    const c = setup().chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    await c.say('berapa harga beras sekarang?');
    expect(c.last[0].body).toContain('belum mengerti');
    expect(c.titles()).toEqual(['Mulai', 'Ganti bahasa', 'Ganti negara']);
    await c.voice();                        // voice note that could not be transcribed
    expect(c.last[0].body).toContain('pesan suara');
    expect(c.titles()).toEqual(['Mulai', 'Ganti bahasa', 'Ganti negara']);
  });

  it('does not accept photos, and asks people not to send ID pictures', async () => {
    const c = setup().chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    await c.photo();
    expect(c.last[0].body).toContain('jangan kirim foto KTP');
    expect(c.titles()).toEqual(['Mulai', 'Ganti bahasa', 'Ganti negara']);
  });

  it('ignores a tap on a button from an earlier message', async () => {
    const t = setup();
    const c = t.chat(ID);
    await c.say('halo');
    await c.tap('Bahasa Indonesia');
    await c.tap('Mulai');
    await c.tap('Jawa Timur');
    await c.tap('Kota Surabaya');
    const oldYes = c.options().find((o) => o.title === 'Ya')!.id;
    await c.tap('Ya');
    await c.tapId(oldYes);                  // same button again, now a different question is on screen
    expect(c.last[0].body).toContain('belum mengerti');
    expect(Object.keys(t.store.getUser(ID)!.facts)).toEqual(['ktp_surabaya']);
  });

  it('pages long lists and keeps numbers stable', async () => {
    const countries = loadCountries();
    for (const pack of Object.values(countries.get('in')!.byLang)) {
      pack.meta.regions = Array.from({ length: 14 }, (_, i) => ({ id: `s${i + 1}`, name: `State ${i + 1}` }));
    }
    const t = setup({ countries, approve: false });
    const c = t.chat(IN);
    await c.say('hi');
    await c.tap('Start');
    expect(c.titles()).toHaveLength(10);
    expect(c.titles().at(-1)).toBe('More');
    await c.tap('More');
    expect(c.titles()).toEqual(['State 10', 'State 11', 'State 12', 'State 13', 'State 14']);
    expect(c.options()[0].n).toBe(10);
    await c.say('12');
    expect(t.store.getUser(IN)!.region).toEqual(['s12']);
  });
});

describe('countries', () => {
  it('guesses the country from the phone number, and skips the language question when there is one language', async () => {
    const c = setup().chat(IN);
    await c.say('hi');
    expect(c.body()).toContain('India');
    expect(c.titles()).toEqual(['Start', 'Change country']);
  });

  it('switches country from the chat with no code change', async () => {
    const t = setup();
    const c = t.chat(ID);
    await toSurabayaResults(c);
    await c.say('ganti negara');
    expect(c.titles()).toEqual(['Indonesia', 'India']);
    await c.tap('India');
    expect(c.body()).toContain('government support');
    await c.tap('Start');
    await c.tap('Other state');
    const asked = await c.answer({ income: 'low', school_child: 'yes' });
    expect(asked).toEqual(['income', 'school_child']);
    expect(c.titles()).toEqual(['Sample: scholarship', 'Sample: food ration', 'Start again']);
    expect(t.store.getUser(ID)).toMatchObject({ country: 'in', lang: 'en' });
  });
});

describe('personal data', () => {
  it('erases answers and events on request, in either language', async () => {
    const t = setup();
    const c = t.chat(ID);
    await toSurabayaResults(c);
    await c.say('DELETE MY DATA');
    expect(c.titles()).toEqual(['Ya, hapus', 'Batal']);
    await c.tap('Ya, hapus');
    expect(c.body()).toContain('sudah dihapus');
    expect(t.store.getUser(ID)).toBeNull();
    expect(t.store.events(ID)).toEqual([]);
    expect(t.store.results(ID)).toEqual([]);
  });

  it('brings the list back after finishing', async () => {
    const c = setup().chat(ID);
    await toSurabayaResults(c);
    await c.tap('Berobat gratis pakai KTP');
    await c.tap('Cara daftar');
    await c.tap('Sudah punya');
    await c.tap('Selesai');
    await c.say('halo lagi');
    expect(c.titles()).toContain('KIP Kuliah');
  });
});
