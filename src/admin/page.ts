/** The admin page. Plain HTML and a little script; all text is inserted with textContent. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>realSocial admin</title>
<style>
  :root { --bg:#f5f6f8; --card:#fff; --ink:#1b2430; --muted:#5b6676; --line:#d8dde6; --ok:#17794a; --bad:#b3261e; --accent:#1f5fbf; --soft:#eaf1fd; --mark:#fff4cc; }
  @media (prefers-color-scheme: dark) { :root { --bg:#11151b; --card:#1a2029; --ink:#e7ebf1; --muted:#9aa5b5; --line:#2d3643; --ok:#5fd39a; --bad:#ff8a80; --accent:#7fb0ff; --soft:#1d2a40; --mark:#4a3f12; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 20px 16px 72px; }
  h1 { font-size: 21px; margin: 0; } h2 { font-size: 17px; margin: 0 0 4px; } h3 { font-size: 15px; margin: 18px 0 6px; }
  .muted { color: var(--muted); } .small { font-size: 13px; } .error { color: var(--bad); } .good { color: var(--ok); }
  .top { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:baseline; justify-content:space-between; margin-bottom:14px; }
  .tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; border-bottom:1px solid var(--line); }
  .tabs button { border:0; border-bottom:3px solid transparent; border-radius:0; background:none; padding:9px 14px; color:var(--muted); font-weight:600; }
  .tabs button.on { color:var(--accent); border-bottom-color:var(--accent); }
  .tabs .n { background:var(--soft); color:var(--accent); border-radius:999px; padding:0 8px; margin-left:6px; font-size:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:14px; }
  .head { display:flex; flex-wrap:wrap; gap:6px 14px; align-items:baseline; } .head b { font-size:16px; }
  .tag { border:1px solid var(--line); border-radius:999px; padding:1px 9px; font-size:12px; color:var(--muted); white-space:nowrap; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap:12px; }
  .two { display:grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap:18px; } @media (max-width: 800px) { .two { grid-template-columns: 1fr; } }
  .langs { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:8px; }
  label { display:block; margin:12px 0 4px; font-weight:600; } label.inline { display:flex; gap:8px; align-items:center; font-weight:400; margin:0; }
  input, select, textarea { font:inherit; width:100%; padding:8px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--ink); }
  input[type=checkbox] { width:auto; } textarea { min-height:74px; resize:vertical; } textarea.code { font:12.5px/1.45 ui-monospace, monospace; min-height:150px; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; } button.ok { background:var(--ok); border-color:var(--ok); color:#fff; }
  button.bad { color:var(--bad); border-color:var(--bad); } button:disabled { opacity:.5; cursor:not-allowed; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:14px; }
  pre { margin:0; padding:10px; background:var(--bg); border:1px solid var(--line); border-radius:8px; overflow:auto; max-height:380px; font:12.5px/1.45 ui-monospace, monospace; white-space:pre-wrap; }
  mark { background: var(--mark); color: inherit; padding: 0 4px; border-radius: 4px; }
  .side { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px; align-self:start; }
  .side ul, .rule ul { margin:4px 0 0; padding-left:20px; } .side li { margin-bottom:6px; }
  .rule { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 12px; }
  .q { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:10px; }
  .count { font-size:12px; color:var(--muted); } .count.over { color:var(--bad); font-weight:600; }
  table { width:100%; border-collapse:collapse; } td, th { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  .steps { display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px; margin-bottom:16px; }
  .steps div { background:var(--soft); border-radius:8px; padding:10px 12px; } .steps b { display:block; }
  details > summary { cursor:pointer; color:var(--muted); } a { color:var(--accent); }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <div class="top">
    <h1>realSocial admin</h1>
    <div class="muted small">Nothing reaches people on WhatsApp until you approve it. Signed in as <b id="who">…</b>.</div>
  </div>
  <div class="tabs" id="tabs"></div>

  <section id="tab-sources">
    <div class="steps">
      <div><b>1. Save sources</b><span class="small">Add official links or documents for a country or region. Saving does not read them.</span></div>
      <div><b>2. Read and draft</b><span class="small">When you are ready, pick one source. You get a draft program and the questions it needs.</span></div>
      <div><b>3. Check and publish</b><span class="small">Edit the draft in a form beside quotes from the source, then approve it.</span></div>
    </div>
    <div class="card">
      <h2>Add a source</h2>
      <div class="grid">
        <div><label for="sCountry">Country</label><select id="sCountry"></select></div>
        <div><label for="sRegion">Region</label><select id="sRegion"></select></div>
        <div><label for="sTitle">Short name</label><input id="sTitle" placeholder="e.g. Disability aids poster"></div>
      </div>
      <label for="sUrl" id="sUrlLabel">Link to the official page, PDF, or image</label>
      <input id="sUrl" type="url" placeholder="https://...">
      <label for="sFile">Or upload the document (optional)</label>
      <input id="sFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.html,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/html">
      <div class="muted small" style="margin-top:4px">Upload a PDF, photo, or screenshot when a page cannot be read from its link (some sites only load inside a browser). Keep the link above so people can be shown where the information came from.</div>
      <div class="actions"><button class="primary" id="sSave">Save source</button><span id="sMsg"></span></div>
    </div>
    <h3>Saved sources</h3>
    <div id="sources"></div>
  </section>

  <section id="tab-drafts" hidden>
    <div class="muted" style="margin-bottom:12px">Drafts made from your sources. Check each against its source, correct anything, then publish. A draft is never shown to people until you publish it.</div>
    <div id="drafts"></div>
  </section>

  <section id="tab-approvals" hidden>
    <div class="muted" style="margin-bottom:12px">Changes that arrived another way (from the catalog files, or entered as text) and are waiting for your decision.</div>
    <div id="pending"></div>
    <details class="card">
      <summary>Advanced: enter or remove a program as text</summary>
      <div class="grid">
        <div><label for="aCountry">Country</label><select id="aCountry"></select></div>
        <div><label for="aRegion">Region</label><select id="aRegion"></select></div>
        <div><label for="aKind">Type</label><select id="aKind"><option value="upsert">Add or change a program</option><option value="remove">Remove a program</option></select></div>
      </div>
      <label for="aNote">What changed, and where was it announced? (include the link)</label>
      <input id="aNote">
      <label for="aYaml">Program text (YAML). To remove a program, write only its id, for example: id: pkh</label>
      <textarea id="aYaml" class="code" spellcheck="false"></textarea>
      <div class="actions"><button id="aSave">Save as pending</button><span id="aMsg"></span></div>
    </details>
  </section>

  <section id="tab-live" hidden>
    <div class="card"><table><thead><tr><th>Program</th><th>Country</th><th>Region</th><th>Checked on</th><th>Approved by</th></tr></thead><tbody id="live"></tbody></table></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props || {}); for (const k of kids) if (k !== null && k !== undefined && k !== '') n.append(k); return n; };
const LANG = { id: 'Bahasa Indonesia', en: 'English', hi: 'Hindi' };
const LIMIT = { title: 24, benefit: 72, label: 24 };
let S = null, tab = 'sources';
const open = new Set();          // drafts whose form is expanded
const edits = new Map();         // draft id -> { program, questions } being edited

async function api(path, body) {
  // location.origin never includes sign-in details, so this also works when they were typed into the address.
  const res = await fetch(location.origin + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data.result;
}
const country = (code) => S.countries.find((c) => c.code === code);
const regionName = (code, scope) => { const p = scope.join('/'); return p ? (country(code)?.regions.find((r) => r.path === p)?.name || p) : 'Whole country'; };
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const say = (node, text, cls) => { node.className = cls || ''; node.textContent = text; };

// ---------- tabs ----------
function renderTabs() {
  const items = [['sources', 'Sources', S.sources.length], ['drafts', 'Drafts to check', S.drafts.length], ['approvals', 'Other approvals', S.pending.length], ['live', 'Live on WhatsApp', S.live.length]];
  $('tabs').replaceChildren(...items.map(([id, name, n]) => {
    const b = el('button', { className: tab === id ? 'on' : '' }, name, el('span', { className: 'n', textContent: String(n) }));
    b.onclick = () => { tab = id; render(); };
    return b;
  }));
  for (const [id] of items) $('tab-' + id).hidden = tab !== id;
}
function fillCountry(sel, regionSel) {
  if (!sel.options.length) for (const c of S.countries) sel.append(el('option', { value: c.code, textContent: c.name }));
  const fill = () => regionSel.replaceChildren(el('option', { value: '', textContent: 'Whole country' }), ...country(sel.value).regions.map((r) => el('option', { value: r.path, textContent: r.name })));
  if (!regionSel.options.length) fill();
  sel.onchange = fill;
}

// ---------- 1. sources ----------
function sourceCard(s) {
  const msg = el('span', { className: 'small' });
  const read = el('button', { className: 'primary', textContent: s.openDrafts ? 'Read again' : 'Read and draft', disabled: !S.canExtract });
  read.onclick = async () => {
    read.disabled = true; say(msg, 'Reading the source. This can take a minute…', 'muted small');
    try {
      const r = await api('/admin/api/sources/' + s.id + '/extract', {});
      open.add(r.draftId); tab = 'drafts'; await load();
    } catch (e) { say(msg, e.message, 'error small'); read.disabled = false; }
  };
  const remove = el('button', { textContent: 'Remove' });
  remove.onclick = async () => { if (!confirm('Remove this source and its unpublished drafts?')) return; try { await api('/admin/api/sources/' + s.id + '/delete', {}); await load(); } catch (e) { say(msg, e.message, 'error small'); } };
  const link = el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', textContent: s.url });
  return el('div', { className: 'card' },
    el('div', { className: 'head' }, el('b', { textContent: s.title }), el('span', { className: 'tag', textContent: country(s.country)?.name + ' · ' + regionName(s.country, s.scope) }),
      s.fileName ? el('span', { className: 'tag', textContent: 'File: ' + s.fileName }) : '', s.openDrafts ? el('span', { className: 'tag', textContent: s.openDrafts + ' draft' + (s.openDrafts > 1 ? 's' : '') + ' to check' }) : ''),
    el('div', { className: 'small', style: 'word-break:break-all' }, link),
    el('div', { className: 'muted small', textContent: 'Added ' + when(s.addedAt) + ' by ' + s.addedBy }),
    el('div', { className: 'actions' }, read, remove, msg));
}
$('sFile').onchange = () => { $('sUrlLabel').textContent = $('sFile').files.length ? 'Web address this document came from' : 'Link to the official page, PDF, or image'; };
$('sSave').onclick = async () => {
  const m = $('sMsg'); say(m, '');
  try {
    let file = null;
    const f = $('sFile').files[0];
    if (f) {
      if (f.size > 8 * 1024 * 1024) throw new Error('That file is too large (limit 8 MB).');
      const bytes = new Uint8Array(await f.arrayBuffer()); let bin = '';
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      file = { name: f.name, type: f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''), data: btoa(bin) };
    }
    await api('/admin/api/sources', { country: $('sCountry').value, scope: $('sRegion').value, title: $('sTitle').value, url: $('sUrl').value, file });
    $('sTitle').value = ''; $('sUrl').value = ''; $('sFile').value = ''; $('sFile').onchange();
    await load(); say($('sMsg'), 'Saved. Press "Read and draft" on it when you are ready.', 'good');
  } catch (e) { say(m, e.message, 'error'); }
};

// ---------- 3. draft form ----------
const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Makes a text or list value match the country's languages: one value, or one per language. */
function shape(v, ls, list) {
  const empty = list ? [] : '';
  if (ls.length === 1) return isMap(v) ? (v[ls[0]] ?? empty) : (v ?? empty);
  const out = {}; for (const l of ls) out[l] = isMap(v) ? (v[l] ?? empty) : (v ?? empty); return out;
}
/** A labelled input per language, bound to obj[key]. opts: list (one item per line), long, max. */
function field(label, obj, key, ls, opts) {
  opts = opts || {};
  obj[key] = shape(obj[key], ls, opts.list);
  const row = el('div', { className: 'langs' });
  for (const l of ls) {
    const cur = ls.length > 1 ? obj[key][l] : obj[key];
    const inp = el(opts.list || opts.long ? 'textarea' : 'input');
    inp.value = opts.list ? cur.join('\\n') : cur;
    const count = el('span', { className: 'count' });
    const sync = () => {
      const v = opts.list ? inp.value.split('\\n').map((x) => x.trim()).filter(Boolean) : inp.value;
      if (ls.length > 1) obj[key][l] = v; else obj[key] = v;
      if (opts.max) { count.textContent = inp.value.length + ' / ' + opts.max; count.className = 'count' + (inp.value.length > opts.max ? ' over' : ''); }
    };
    inp.oninput = sync; sync();
    row.append(el('div', null, ls.length > 1 ? el('div', { className: 'count', textContent: LANG[l] || l }) : '', inp, opts.max ? count : ''));
  }
  return el('div', null, el('label', { textContent: label }), opts.hint ? el('div', { className: 'muted small', textContent: opts.hint }) : '', row);
}
const pick = (v, ls) => (isMap(v) ? (v.en ?? v[ls[0]]) : v);
function describe(rule, qs, ls) {
  if (!rule || typeof rule !== 'object') return el('li', { className: 'error', textContent: 'No rule set.' });
  if (rule.fact) {
    const q = qs.find((x) => x.id === rule.fact);
    const answers = (rule.in || []).map((v) => { const o = q && q.options.find((x) => x.value === v); return o ? pick(o.label, ls) : v; });
    return el('li', null, el('span', { textContent: '“' + (q ? pick(q.text, ls) : rule.fact) + '”' }), ' → ', el('b', { textContent: answers.join(' or ') }), q ? '' : el('span', { className: 'error', textContent: ' (no such question)' }));
  }
  const kids = rule.all || rule.any || (rule.not ? [rule.not] : []);
  const head = rule.all ? 'All of these must be true:' : rule.any ? 'At least one of these must be true:' : 'This must NOT be true:';
  return el('li', null, head, el('ul', null, ...kids.map((k) => describe(k, qs, ls))));
}
function routeBlock(name, program, key, c, ls) {
  const how = program.how_to_apply;
  const body = el('div');
  const on = el('input', { type: 'checkbox', checked: !!how[key] });
  const draw = () => {
    body.replaceChildren();
    if (!how[key]) return;
    const r = how[key];
    if (key === 'in_person') {
      const sel = el('select', null, ...c.offices.map((o) => el('option', { value: o.id, textContent: o.name })));
      if (!c.offices.some((o) => o.id === r.office)) r.office = c.offices[0] && c.offices[0].id;
      sel.value = r.office; sel.onchange = () => { r.office = sel.value; };
      body.append(el('label', { textContent: 'Office to go to' }), sel, field('Documents to bring (one per line)', r, 'bring', ls, { list: true }));
    } else {
      const url = el('input', { type: 'url', value: r.url || '' }); url.oninput = () => { r.url = url.value.trim(); };
      body.append(el('label', { textContent: 'Website address' }), url, field('Have ready (one per line)', r, 'ready', ls, { list: true }));
    }
    body.append(field('Steps (one per line, in order)', r, 'steps', ls, { list: true }), field('Cost', r, 'cost', ls), field('How long it takes', r, 'time', ls));
  };
  on.onchange = () => { if (on.checked) how[key] = how['_' + key] || (key === 'in_person' ? { office: '', bring: [], steps: [], cost: '', time: '' } : { url: '', ready: [], steps: [] }); else { how['_' + key] = how[key]; delete how[key]; } draw(); };
  draw();
  return el('div', null, el('h3', null, el('label', { className: 'inline', style: 'font-weight:600' }, on, name)), body);
}
/** Removes empty optional fields so the saved entry is clean. */
function tidy(program) {
  const p = JSON.parse(JSON.stringify(program));
  const blank = (v) => v === '' || v == null || (isMap(v) && Object.values(v).every((x) => x === '' || x == null));
  if (blank(p.note)) delete p.note;
  for (const k of Object.keys(p.how_to_apply || {})) if (k.startsWith('_')) delete p.how_to_apply[k];
  const online = p.how_to_apply && p.how_to_apply.online;
  if (online) for (const k of ['cost', 'time']) if (blank(online[k])) delete online[k];
  return p;
}
function draftCard(d) {
  const c = country(d.country), ls = c.languages;
  if (!edits.has(d.id)) edits.set(d.id, { program: d.program ? JSON.parse(JSON.stringify(d.program)) : null, questions: JSON.parse(JSON.stringify(d.questions || [])) });
  const e = edits.get(d.id);
  const src = d.sourceUrl ? el('a', { href: d.sourceUrl, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open source' }) : '';
  const toggle = el('button', { textContent: open.has(d.id) ? 'Close' : 'Check and edit' });
  toggle.onclick = () => { open.has(d.id) ? open.delete(d.id) : open.add(d.id); render(); };
  const msg = el('span');
  const discard = el('button', { className: 'bad', textContent: 'Discard draft' });
  discard.onclick = async () => { if (!confirm('Discard this draft?')) return; try { await api('/admin/api/drafts/' + d.id + '/discard', {}); edits.delete(d.id); await load(); } catch (x) { say(msg, x.message, 'error'); } };
  const head = el('div', { className: 'head' }, el('b', { textContent: e.program ? (pick(e.program.title, ls) || e.program.id) : 'No program found' }),
    el('span', { className: 'tag', textContent: c.name + ' · ' + regionName(d.country, d.scope) }), el('span', { className: 'muted small', textContent: 'From “' + d.sourceTitle + '”, ' + when(d.createdAt) }), src);
  const side = el('div', { className: 'side' });
  if (d.warnings.length) side.append(el('b', { textContent: 'Check these' }), el('ul', null, ...d.warnings.map((w) => el('li', { textContent: w }))));
  if (d.evidence.length) side.append(el('b', { textContent: 'What the source says' }), el('ul', null, ...d.evidence.map((x) => el('li', null, el('span', { className: 'count', textContent: x.field + ' ' }), '“' + x.quote + '”'))));

  if (!e.program) {
    return el('div', { className: 'card' }, head,
      el('p', { textContent: 'This source does not describe a specific program people can apply for, so there is nothing to publish. The notes below say why and what to look for instead.' }),
      side, el('div', { className: 'actions' }, discard, msg));
  }
  if (!open.has(d.id)) return el('div', { className: 'card' }, head, el('div', { className: 'muted', textContent: pick(e.program.benefit, ls) || '' }), el('div', { className: 'actions' }, toggle, discard, msg));

  const p = e.program;
  p.how_to_apply = p.how_to_apply || {};
  const ruleBox = el('div', { className: 'rule' });
  const allQs = () => [...c.questions, ...e.questions];
  const drawRule = () => ruleBox.replaceChildren(el('ul', { style: 'padding-left:16px' }, describe(p.eligibility, allQs(), ls)));
  const ruleText = el('textarea', { className: 'code', spellcheck: false, value: JSON.stringify(p.eligibility, null, 2) });
  const ruleMsg = el('div', { className: 'small' });
  ruleText.oninput = () => { try { p.eligibility = JSON.parse(ruleText.value); say(ruleMsg, ''); drawRule(); } catch (x) { say(ruleMsg, 'Not valid yet: ' + x.message, 'error small'); } };
  drawRule();

  const qList = el('div');
  const drawQs = () => {
    qList.replaceChildren(...(e.questions.length ? e.questions.map((q, i) => {
      const rm = el('button', { className: 'bad', textContent: 'Remove question' });
      rm.onclick = () => { e.questions.splice(i, 1); drawQs(); drawRule(); };
      return el('div', { className: 'q' }, el('div', { className: 'count', textContent: 'New question · id: ' + q.id }), field('Question the bot will ask', q, 'text', ls, { long: true }),
        el('label', { textContent: 'Answer buttons' }), ...q.options.map((o) => field('Answer “' + o.value + '”', o, 'label', ls, { max: LIMIT.label })), el('div', { className: 'actions' }, rm));
    }) : [el('div', { className: 'muted', textContent: 'None. This program only uses questions the bot already asks.' })]));
  };
  drawQs();

  const prio = el('input', { type: 'number', min: 1, max: 100, value: p.priority }); prio.oninput = () => { p.priority = Number(prio.value); };
  const checked = el('input', { type: 'checkbox' });
  const publish = el('button', { className: 'ok', textContent: 'Approve and publish', disabled: true });
  checked.onchange = () => { publish.disabled = !checked.checked; };
  const later = el('button', { textContent: 'Save for later' });
  const payload = () => ({ program: tidy(p), questions: e.questions });
  later.onclick = async () => {
    try { const r = await api('/admin/api/drafts/' + d.id + '/save', payload()); say(msg, r.problem ? 'Saved. Still to fix before publishing: ' + r.problem : 'Saved. It passes all checks.', r.problem ? 'error' : 'good'); }
    catch (x) { say(msg, x.message, 'error'); }
  };
  publish.onclick = async () => {
    publish.disabled = true;
    try { await api('/admin/api/drafts/' + d.id + '/publish', { ...payload(), checked: true }); edits.delete(d.id); open.delete(d.id); tab = 'live'; await load(); }
    catch (x) { say(msg, 'Not published: ' + x.message, 'error'); publish.disabled = !checked.checked; }
  };

  const form = el('div', null,
    el('h3', { textContent: 'What people see in the list' }),
    field('Name (one line in the list)', p, 'title', ls, { max: LIMIT.title }),
    field('What they get', p, 'benefit', ls, { max: LIMIT.benefit }),
    field('Who it is for', p, 'why', ls, { long: true }),
    el('label', { textContent: 'Order in the list (1 to 100, higher is shown first)' }), prio,
    el('h3', { textContent: 'Who qualifies' }),
    el('div', { className: 'muted small', textContent: 'The program is offered to a person when their answers match this.' }), ruleBox,
    el('details', { style: 'margin-top:6px' }, el('summary', { className: 'small', textContent: 'Edit the rule (advanced)' }), ruleText, ruleMsg),
    el('h3', { textContent: 'New questions for the questionnaire' }),
    el('div', { className: 'muted small', textContent: 'Questions this program needs that the bot does not ask yet. They go live together with the program.' }), qList,
    routeBlock('Apply in person', p, 'in_person', c, ls),
    routeBlock('Apply online', p, 'online', c, ls),
    el('h3', { textContent: 'Extra note (optional)' }), field('Shown after the steps', p, 'note', ls, { long: true }));

  return el('div', { className: 'card' }, head, el('div', { className: 'two', style: 'margin-top:10px' }, form, side),
    el('div', { className: 'actions' }, el('label', { className: 'inline' }, checked, 'I checked this against the source'), publish, later, toggle, discard), el('div', { style: 'margin-top:8px' }, msg));
}

// ---------- other approvals ----------
function pendingCard(c) {
  const kind = c.kind === 'remove' ? 'Remove' : (c.live ? 'Change' : 'New');
  const msg = el('span', { className: 'error' });
  const checked = el('input', { type: 'checkbox' });
  const approve = el('button', { className: 'ok', textContent: 'Approve and publish', disabled: true });
  const reject = el('button', { className: 'bad', textContent: 'Reject' });
  checked.onchange = () => { approve.disabled = !checked.checked; };
  const run = async (path, body) => { msg.textContent = ''; try { await api(path, body); await load(); } catch (e) { msg.textContent = e.message; } };
  approve.onclick = () => run('/admin/api/changes/' + c.id + '/approve', { checked: true });
  reject.onclick = () => { const reason = prompt('Why is this rejected?'); if (reason) run('/admin/api/changes/' + c.id + '/reject', { reason }); };
  const cols = el('div', { className: 'grid', style: 'margin:10px 0' });
  if (c.kind !== 'remove') cols.append(el('div', null, el('div', { className: 'muted small', textContent: 'Proposed' }), el('pre', { textContent: c.proposed })));
  if (c.questions) cols.append(el('div', null, el('div', { className: 'muted small', textContent: 'New questions' }), el('pre', { textContent: c.questions })));
  if (c.live) cols.append(el('div', null, el('div', { className: 'muted small', textContent: 'Live now' }), el('pre', { textContent: c.live })));
  const changed = el('div');
  if (c.changedFields.length) { changed.append('Changed: '); for (const f of c.changedFields) changed.append(el('mark', { textContent: f }), ' '); }
  return el('div', { className: 'card' },
    el('div', { className: 'head' }, el('b', { textContent: c.programId }), el('span', { className: 'tag', textContent: kind }),
      el('span', { className: 'tag', textContent: (country(c.country)?.name || c.country) + ' · ' + regionName(c.country, c.scope) }),
      el('span', { className: 'muted small', textContent: 'from ' + c.submittedBy + ', ' + when(c.submittedAt) })),
    el('div', { textContent: c.note }), changed, el('details', null, el('summary', { className: 'small', textContent: 'Show details' }), cols),
    el('div', { className: 'actions' }, el('label', { className: 'inline' }, checked, 'I checked this against the official source'), approve, reject, msg));
}
$('aSave').onclick = async () => {
  const m = $('aMsg'); say(m, '');
  if (!$('aYaml').value.trim()) return say(m, 'There is no program text to save yet.', 'error');
  try {
    await api('/admin/api/changes', { country: $('aCountry').value, scope: $('aRegion').value, kind: $('aKind').value, note: $('aNote').value, yaml: $('aYaml').value });
    $('aYaml').value = ''; $('aNote').value = ''; await load(); say($('aMsg'), 'Saved as pending.', 'good');
  } catch (e) { say(m, e.message, 'error'); }
};

// ---------- render ----------
const none = (text) => el('div', { className: 'card muted', textContent: text });
function render() {
  $('who').textContent = S.reviewer;
  renderTabs();
  fillCountry($('sCountry'), $('sRegion')); fillCountry($('aCountry'), $('aRegion'));
  $('sources').replaceChildren(...(S.sources.length ? S.sources.map(sourceCard) : [none('No sources yet. Add the first one above.')]));
  if (!S.canExtract) $('sources').prepend(el('div', { className: 'card error', textContent: 'Reading sources is off. Set ANTHROPIC_API_KEY and restart to turn it on. You can still save sources.' }));
  $('drafts').replaceChildren(...(S.drafts.length ? S.drafts.map(draftCard) : [none('No drafts to check. Go to Sources and press "Read and draft" on one.')]));
  $('pending').replaceChildren(...(S.pending.length ? S.pending.map(pendingCard) : [none('Nothing is waiting.')]));
  $('live').replaceChildren(...(S.live.length ? S.live.map((p) => el('tr', null, el('td', null, el('b', { textContent: p.title }), el('div', { className: 'count', textContent: p.programId })),
    el('td', { textContent: country(p.country)?.name || p.country }), el('td', { textContent: regionName(p.country, p.scope) }), el('td', { textContent: p.verified || '' }), el('td', { textContent: p.approvedBy || '' })))
    : [el('tr', null, el('td', { colSpan: 5, className: 'muted', textContent: 'No program is live yet.' }))]));
}
async function load() { S = await api('/admin/api/state'); render(); }
load().catch((e) => { document.querySelector('main').append(el('div', { className: 'card error', textContent: e.message })); });
</script>
</body>
</html>`;
