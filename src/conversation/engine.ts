import { fmt, nodesAt, programsFor, type Country, type Pack } from '../catalog/loader';
import type { LiveCatalog } from '../catalog/live';
import { LANGUAGE_NAMES, LIMITS, type Program } from '../catalog/schema';
import { MORE, type Inbound, type Opt, type Outbound } from '../channels/types';
import { eligible, nextQuestion, reason } from '../eligibility/planner';
import { checklist, type Route } from '../nextsteps/builder';
import type { Store, User } from '../store/db';
import { norm, type Understand } from '../understand/intent';

type Step =
  | 'language' | 'welcome' | 'country' | 'region' | 'question' | 'results' | 'program' | 'route'
  | 'docs' | 'after' | 'confirm_delete' | 'idle';

interface Session {
  step: Step;
  path: string[];          // region being picked, level by level
  question?: string;
  program?: string;
  options: Opt[];          // every option of the current prompt (may span several pages)
  page: number;
  prompt: string;          // body of the current prompt, so it can be shown again
  seq: number;             // changes with every new prompt, so taps on old buttons are not mistaken for answers
  profileDone: boolean;
}

export interface Deps {
  countries: Map<string, Country>;
  catalog: Pick<LiveCatalog, 'programs' | 'questions'>;
  store: Store;
  understand: Understand;
  /** Who runs the service; shown in the first message so people know who they are talking to. */
  operator: string;
  defaultCountry?: string;
  now?: () => Date;
}

const PAGE = LIMITS.listRows - 1; // leave one row for "More"
const text = (body: string): Outbound => ({ kind: 'text', body });
const freshSession = (seq = 0): Session => ({ step: 'welcome', path: [], options: [], page: 0, prompt: '', seq, profileDone: false });

/**
 * The whole conversation as a state machine. It never decides eligibility itself (rules do), only shows
 * programs a reviewer has approved, and never writes free text (every message comes from the country pack).
 */
export class Engine {
  constructor(private d: Deps) {}

  private now = () => (this.d.now ?? (() => new Date()))();
  private country = (u: User) => this.d.countries.get(u.country)!;
  private pack = (u: User): Pack => this.country(u).byLang[u.lang];
  private live = (u: User): Program[] => programsFor(this.d.catalog.programs(u.country, u.lang), u.region);
  private program = (u: User): Program | undefined =>
    this.d.catalog.programs(u.country, u.lang).find((p) => p.id === u.session.program);

  async handle(msg: Inbound): Promise<Outbound[]> {
    const { store } = this.d;
    let user = store.getUser(msg.from);
    if (!user) {
      user = this.newUser(msg.from);
      const out = this.begin(user);
      store.saveUser(user);
      store.addEvent(user.phone, 'started', null, { country: user.country });
      return out;
    }
    const out = await this.route(user, msg);
    if (store.getUser(user.phone)) store.saveUser(user); // skipped when the person just deleted their data
    return out;
  }

  // ---- input handling ------------------------------------------------------------------------

  private async route(user: User, msg: Inbound): Promise<Outbound[]> {
    const S = this.pack(user).strings;
    const s: Session = user.session;

    // Nothing is ever collected as a file: say so, and keep ID photos out of the chat.
    if (msg.kind === 'media') return [text(S.no_media), ...this.reshow(user)];

    let choice: string | null;
    if (msg.kind === 'choice') {
      const cut = msg.id.indexOf('|');
      choice = Number(msg.id.slice(0, cut)) === s.seq ? msg.id.slice(cut + 1) : null;
    } else {
      const raw = msg.kind === 'voice' ? await this.d.understand.transcribe(msg) : msg.text;
      if (raw === null) return [text(S.voice_unavailable), ...this.reshow(user)];
      const command = this.command(norm(raw), user);
      if (command) return command;
      if (s.step === 'idle') return this.resume(user);
      choice = await this.pick(raw, user);
    }

    const known = choice === MORE ? this.visible(s).some((o) => o.id === MORE) : s.options.some((o) => o.id === choice);
    if (!choice || !known) {
      // Covers unclear text and taps on buttons from an older message.
      if (s.step === 'idle') return this.resume(user);
      return [text(S.not_understood), ...this.reshow(user)];
    }
    if (choice === MORE) {
      s.page += 1;
      return this.reshow(user);
    }
    return this.step(user, choice);
  }

  /** Words that work at any point in the chat, in any of the country's languages. */
  private command(t: string, user: User): Outbound[] | null {
    const all = Object.values(this.country(user).byLang).map((p) => p.strings);
    const is = (key: 'cmd_delete' | 'cmd_country' | 'cmd_language' | 'cmd_menu') => all.some((S) => norm(S[key]) === t);
    if (is('cmd_delete')) {
      const S = this.pack(user).strings;
      user.session.step = 'confirm_delete';
      return this.ask(user, S.delete_confirm, [{ id: 'yes', title: S.delete_yes }, { id: 'no', title: S.delete_no }]);
    }
    if (is('cmd_country')) return this.askCountry(user);
    if (is('cmd_language') && this.country(user).languages.length > 1) return this.askLanguage(user);
    if (is('cmd_menu')) return this.resume(user);
    return null;
  }

  private async pick(raw: string, user: User): Promise<string | null> {
    const s: Session = user.session;
    const t = raw.trim();
    if (/^\d{1,2}$/.test(t)) return s.options.find((o) => o.n === Number(t))?.id ?? null;
    const more = this.pack(user).strings.more;
    const shown = this.visible(s).map((o) => (o.id === MORE ? { ...o, title: more } : o));
    const exact = shown.find((o) => norm(o.title) === norm(t));
    if (exact) return exact.id;
    return this.d.understand.pick(t, shown, user.lang);
  }

  // ---- prompts -------------------------------------------------------------------------------

  private visible(s: Session): Opt[] {
    if (s.options.length <= LIMITS.listRows) return s.options;
    const start = s.page * PAGE;
    const slice = s.options.slice(start, start + PAGE);
    return start + PAGE < s.options.length ? [...slice, { id: MORE, title: '' }] : slice;
  }

  private reshow(user: User): Outbound[] {
    const S = this.pack(user).strings;
    const s: Session = user.session;
    const options = this.visible(s).map((o) => ({ ...o, id: `${s.seq}|${o.id}`, title: o.id === MORE ? S.more : o.title }));
    return [{ kind: 'options', body: s.prompt, button: S.choose, options }];
  }

  private ask(user: User, body: string, options: Opt[]): Outbound[] {
    const s: Session = user.session;
    s.options = options.map((o, i) => ({ ...o, n: i + 1 }));
    s.page = 0;
    s.prompt = body;
    s.seq += 1;
    return this.reshow(user);
  }

  private newUser(phone: string): User {
    const digits = phone.replace(/\D/g, '');
    const all = [...this.d.countries.values()];
    const byPrefix = all.filter((c) => digits.startsWith(c.phonePrefix)).sort((a, b) => b.phonePrefix.length - a.phonePrefix.length)[0];
    const country = byPrefix ?? this.d.countries.get(this.d.defaultCountry ?? '') ?? all[0];
    const stamp = this.now().toISOString();
    return { phone, country: country.code, lang: country.languages[0], region: [], facts: {}, session: freshSession(), firstSeen: stamp, lastSeen: stamp };
  }

  /** First contact (or a new country): pick a language if there is a choice, then the welcome. */
  private begin(user: User): Outbound[] {
    return this.country(user).languages.length > 1 ? this.askLanguage(user) : this.welcome(user);
  }

  private askLanguage(user: User): Outbound[] {
    const country = this.country(user);
    user.session.step = 'language';
    // Shown in every language at once, because we do not know yet which one the person reads.
    const body = country.languages.map((l) => country.byLang[l].strings.pick_language).join('\n');
    return this.ask(user, body, country.languages.map((l) => ({ id: l, title: LANGUAGE_NAMES[l] ?? l })));
  }

  private welcome(user: User): Outbound[] {
    const pack = this.pack(user);
    const S = pack.strings;
    user.session = freshSession(user.session?.seq ?? 0);
    return this.ask(user, fmt(S.welcome, { country: pack.meta.name, operator: this.d.operator }), [
      { id: 'start', title: S.start },
      ...(this.country(user).languages.length > 1 ? [{ id: 'language', title: S.change_language }] : []),
      { id: 'country', title: S.change_country },
    ]);
  }

  private askCountry(user: User): Outbound[] {
    user.session.step = 'country';
    return this.ask(user, this.pack(user).strings.pick_country,
      [...this.d.countries.values()].map((c) => ({ id: c.code, title: (c.byLang[user.lang] ?? c.byLang[c.languages[0]]).meta.name })));
  }

  private askRegion(user: User): Outbound[] {
    const pack = this.pack(user);
    const s: Session = user.session;
    s.step = 'region';
    const level = pack.meta.region_levels[Math.min(s.path.length, pack.meta.region_levels.length - 1)];
    return this.ask(user, fmt(pack.strings.region_prompt, { level }),
      nodesAt(pack.meta.regions, s.path)!.map((n) => ({ id: n.id, title: n.name })));
  }

  /** Picks up where the person left off: welcome, the next question, or their results. */
  private resume(user: User): Outbound[] {
    return user.region.length ? this.advance(user) : this.welcome(user);
  }

  /** Asks the next useful question, or shows results when no answer could change them any more. */
  private advance(user: User): Outbound[] {
    const q = nextQuestion(this.d.catalog.questions(user.country, user.lang), this.live(user), user.facts);
    if (!q) return this.showResults(user);
    user.session.step = 'question';
    user.session.question = q.id;
    return this.ask(user, q.text, q.options.map((o) => ({ id: o.value, title: o.label })));
  }

  private showResults(user: User): Outbound[] {
    const { store } = this.d;
    const S = this.pack(user).strings;
    const s: Session = user.session;
    const list = eligible(this.live(user), user.facts);
    if (!s.profileDone) {
      s.profileDone = true;
      store.addEvent(user.phone, 'profile_completed');
    }
    store.saveResults(user.phone, list.map((p) => ({ programId: p.id, reason: reason(p, user.facts) })));
    store.addEvent(user.phone, 'results_shown', null, { programs: list.map((p) => p.id) });
    s.step = 'results';
    const menu = [
      { id: 'restart', title: S.restart },
      ...(this.country(user).languages.length > 1 ? [{ id: 'language', title: S.change_language }] : []),
    ];
    if (!list.length) return this.ask(user, S.results_none, [...menu, { id: 'country', title: S.change_country }]);
    return this.ask(user, S.results_intro, [
      ...list.map((p) => ({ id: `p:${p.id}`, title: p.title, description: p.benefit })),
      ...menu,
    ]);
  }

  private showProgram(user: User): Outbound[] {
    const S = this.pack(user).strings;
    const p = this.program(user)!;
    user.session.step = 'program';
    return this.ask(user, `*${p.title}*\n${p.benefit}\n\n${S.why_label} ${p.why}`, [
      { id: 'apply', title: S.how_apply },
      { id: 'back', title: S.back },
    ]);
  }

  private askRoute(user: User): Outbound[] {
    const S = this.pack(user).strings;
    const how = this.program(user)!.how_to_apply;
    if (!how.in_person || !how.online) return this.sendChecklist(user, how.in_person ? 'in_person' : 'online');
    user.session.step = 'route';
    return this.ask(user, S.route_prompt, [
      { id: 'in_person', title: S.in_person },
      { id: 'online', title: S.online },
      { id: 'back', title: S.back },
    ]);
  }

  /** Sends the steps, then asks the person to confirm they have the documents listed. Nothing is uploaded. */
  private sendChecklist(user: User, route: Route): Outbound[] {
    const S = this.pack(user).strings;
    const p = this.program(user)!;
    const message = text(checklist(this.pack(user), user.region, p, route, this.now()));
    this.d.store.addEvent(user.phone, 'steps_sent', p.id, { route });
    user.session.step = 'docs';
    return [message, ...this.ask(user, S.docs_prompt, [
      { id: 'have', title: S.docs_have },
      { id: 'missing', title: S.docs_missing },
    ])];
  }

  private askAfter(user: User): Outbound[] {
    const S = this.pack(user).strings;
    user.session.step = 'after';
    return this.ask(user, S.after_prompt, [
      { id: 'applied', title: S.applied },
      { id: 'other', title: S.other_program },
      { id: 'done', title: S.done },
    ]);
  }

  // ---- transitions ---------------------------------------------------------------------------

  private step(user: User, choice: string): Outbound[] {
    const { store } = this.d;
    const pack = this.pack(user);
    const S = pack.strings;
    const s: Session = user.session;

    // A program can be withdrawn by a reviewer while someone is reading about it.
    if (['program', 'route', 'docs', 'after'].includes(s.step) && !this.program(user)) return this.showResults(user);

    switch (s.step) {
      case 'language':
        user.lang = choice;
        store.addEvent(user.phone, 'language_set', null, { lang: choice });
        return this.resume(user);

      case 'welcome':
        if (choice === 'country') return this.askCountry(user);
        if (choice === 'language') return this.askLanguage(user);
        s.path = [];
        return this.askRegion(user);

      case 'country': {
        if (choice === user.country) return this.resume(user);
        user.country = choice;
        const next = this.country(user);
        if (!next.languages.includes(user.lang)) user.lang = next.languages[0];
        user.region = [];
        user.facts = {};
        store.saveResults(user.phone, []);
        store.addEvent(user.phone, 'country_changed', null, { country: choice });
        return this.begin(user);
      }

      case 'region': {
        s.path.push(choice);
        if (nodesAt(pack.meta.regions, s.path)?.length) return this.askRegion(user);
        user.region = [...s.path];
        store.addEvent(user.phone, 'region_set', null, { region: user.region });
        return this.advance(user);
      }

      case 'question':
        user.facts[s.question!] = choice;
        return this.advance(user);

      case 'results':
        if (choice === 'country') return this.askCountry(user);
        if (choice === 'language') return this.askLanguage(user);
        if (choice === 'restart') {
          user.region = [];
          user.facts = {};
          return this.welcome(user);
        }
        s.program = choice.slice(2);
        store.addEvent(user.phone, 'program_picked', s.program);
        return this.showProgram(user);

      case 'program':
        return choice === 'apply' ? this.askRoute(user) : this.showResults(user);

      case 'route':
        return choice === 'back' ? this.showProgram(user) : this.sendChecklist(user, choice as Route);

      case 'docs':
        store.addEvent(user.phone, choice === 'have' ? 'documents_confirmed' : 'documents_missing', s.program);
        return choice === 'have' ? this.askAfter(user) : [text(S.docs_tip), ...this.askAfter(user)];

      case 'after':
        if (choice === 'applied') {
          store.addEvent(user.phone, 'self_reported_applied', s.program);
          return [text(S.thanks_applied), ...this.showResults(user)];
        }
        if (choice === 'other') return this.showResults(user);
        s.step = 'idle';
        s.options = [];
        return [text(S.goodbye)];

      case 'confirm_delete':
        if (choice !== 'yes') return this.resume(user);
        store.deleteUser(user.phone);
        return [text(S.deleted)];

      default:
        return this.resume(user);
    }
  }
}
