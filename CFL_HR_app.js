// חוזה עם החיים (CFL) – ממשק יועצים, צד הדפדפן
// The login is kept in sessionStorage: it lasts for this browser tab only and is gone when the tab closes.
const HR_TOKEN_KEY = 'cfl_hr_token';

const app = document.getElementById('app');
const navName = document.getElementById('navName');
const logoutBtn = document.getElementById('logoutBtn');
let me = null; // { name, email }

function getToken() { try { return sessionStorage.getItem(HR_TOKEN_KEY); } catch (e) { return null; } }
function setToken(v) {
  try { if (v === null) sessionStorage.removeItem(HR_TOKEN_KEY); else sessionStorage.setItem(HR_TOKEN_KEY, v); } catch (e) { }
}

// ===================== Talking to the server =====================
async function api(action, data) {
  const body = Object.assign({ action: action, token: getToken() }, data || {});
  let res;
  try {
    res = await fetch(CFL_HR_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return { ok: false, message: 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.' };
  }
  let out, text = '';
  try { text = await res.text(); out = JSON.parse(text); } catch (e) {
    console.error('HR server reply was not data. Status ' + res.status + ':', text.slice(0, 2000));
    return { ok: false, message: 'השרת החזיר תשובה לא צפויה (בדרך כלל: הרשאות הסקריפט לא אושרו, או שהפריסה אינה פתוחה ל-Anyone). פרטים במסוף הדפדפן.' };
  }
  if (out.auth === false) {
    setToken(null);
    showLogin(out.message);
    return { ok: false, handled: true };
  }
  if (out.me) { me = out.me; navName.textContent = me.name || me.email; logoutBtn.hidden = false; }
  return out;
}

// ===================== Remembering answers (makes moving around fast) =====================
// Lists and נועץ pages are drawn at once from the last visit in this tab, then refreshed in the background.
const CACHE_PREFIX = 'cfl_hr_c_';
function cacheGet(key) {
  try {
    const o = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) || 'null');
    return o && o.token === getToken() ? o.r : null;
  } catch (e) { return null; }
}
function cachePut(key, r) {
  try { sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ token: getToken(), r: r })); } catch (e) { }
}
function cacheDrop(key) { try { sessionStorage.removeItem(CACHE_PREFIX + key); } catch (e) { } }
function cacheClear() {
  try { Object.keys(sessionStorage).filter(k => k.indexOf(CACHE_PREFIX) === 0).forEach(k => sessionStorage.removeItem(k)); } catch (e) { }
  ahead = {};
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A נועץ page starts loading when the mouse moves over its row, so the click opens it faster
let ahead = {}; // email -> { at, promise }
function loadAhead(email) {
  const a = ahead[email];
  if (a && Date.now() - a.at < 30000) return;
  ahead[email] = { at: Date.now(), promise: api('clientGet', { email: email }) };
}
function takeAhead(email) {
  const a = ahead[email];
  delete ahead[email];
  return a && Date.now() - a.at < 30000 ? a.promise : null;
}

let viewSeq = 0; // each screen gets a number; a late answer for an older screen is ignored

// ===================== Building the page =====================
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function render(...nodes) { app.replaceChildren(...nodes.filter(n => n !== null && n !== undefined)); }
function msgBox(text, kind) { return el('div', { class: 'msg ' + (kind || 'error'), role: 'alert' }, text); }
function field(label, input) { return el('label', { class: 'field' }, el('span', {}, label), input); }

async function withBusy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'רגע…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

// ===================== Login with Google =====================
let gsiReady = false;
function onGsiLoad() { gsiReady = true; if (!me && !getToken()) showLogin(); }
window.onGsiLoad = onGsiLoad;

function showLogin(message) {
  me = null;
  viewSeq++;
  navName.textContent = '';
  logoutBtn.hidden = true;
  const msg = el('div');
  if (message) msg.append(msgBox(message));
  const btnBox = el('div', { id: 'gbtn', class: 'gbtn' });
  render(el('div', { class: 'card auth-card' },
    el('h1', {}, 'כניסה ליועצים'),
    el('p', { class: 'sub' }, 'הכניסה עם חשבון Google, ליועצים מורשים בלבד.'),
    msg, btnBox));

  if (!gsiReady || !window.google || !google.accounts || !google.accounts.id) {
    btnBox.append(el('p', { class: 'muted' }, 'טוען את הכניסה של Google…'));
    return; // onGsiLoad will draw the button once Google's script has loaded
  }
  google.accounts.id.initialize({
    client_id: CFL_HR_CLIENT_ID,
    callback: onCredential,
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true
  });
  google.accounts.id.renderButton(btnBox, {
    theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'he', width: 280
  });
}

async function onCredential(resp) {
  const box = document.getElementById('gbtn');
  if (box) box.replaceChildren(el('p', { class: 'muted' }, 'בודקים את הכניסה…'));
  const r = await api('hrLogin', { idToken: resp && resp.credential });
  if (!r.ok) { if (!r.handled) showLogin(r.message); return; }
  setToken(r.token);
  me = { name: r.name, email: r.email };
  showHome();
}

async function logout() {
  cacheClear();
  await api('hrLogout');
  setToken(null);
  try { google.accounts.id.disableAutoSelect(); } catch (e) { }
  showLogin();
}
logoutBtn.addEventListener('click', logout);

// ===================== Signed-in screens: menu, clients, one client, staff =====================
async function ensureMe() {
  if (!getToken()) { showLogin(); return false; }
  if (me) { navName.textContent = me.name || me.email; logoutBtn.hidden = false; }
  return true; // the server checks the login on every request; its answer says who is signed in
}

function menu(active) {
  const item = (key, label, go) => el('button', {
    type: 'button', class: 'menu-item' + (active === key ? ' on' : ''), 'aria-current': active === key ? 'page' : null, onclick: go
  }, label);
  return el('nav', { class: 'menu' }, item('clients', 'נועצים', () => showClients()), item('staff', 'יועצים', () => showStaff()),
    item('settings', 'הגדרות', () => showSettings()));
}

function loading(active) { render(menu(active), el('p', { class: 'loading' }, 'טוען…')); }

async function showHome() { await showClients(); }

// ---------- client list ----------
let clientSearch = '';
async function showClients() {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  const cached = cacheGet('list');
  if (cached) drawClients(cached); else loading('clients');
  const r = await api('clientList');
  if (seq !== viewSeq) return;
  if (!r.ok) { if (!r.handled && !cached) render(menu('clients'), msgBox(r.message)); return; }
  cachePut('list', r);
  if (!cached || !same(cached, r)) drawClients(r, !!cached);
}

// "פתיחת תיק": a יועץ opens a תיק for someone who will sign up later with this email
let newCaseBox = null;
function newCaseButton(r) {
  newCaseBox = el('div');
  return el('button', { type: 'button', class: 'btn primary small', id: 'newCaseBtn', onclick: () => {
    if (newCaseBox.firstChild) { newCaseBox.replaceChildren(); return; }
    newCaseBox.append(newCaseForm(r));
    newCaseBox.querySelector('input').focus();
  } }, 'פתיחת תיק חדש');
}

function newCaseForm(r) {
  const msg = el('div');
  const name = el('input', { type: 'text', id: 'nc_name', maxlength: '60', autocomplete: 'off' });
  const email = el('input', { type: 'email', id: 'nc_email', dir: 'ltr', autocomplete: 'off' });
  const phone = el('input', { type: 'tel', id: 'nc_phone', dir: 'ltr', autocomplete: 'off' });
  const g = radios('nc_gender', [['f', 'נועצת'], ['m', 'נועץ']], '');
  const group = select('nc_group', [['', 'לא נבחרה']].concat(r.groups || []), '');
  const qs = (r.qlist || []).map((q, i) => el('label', { class: 'check' },
    el('input', { type: 'checkbox', value: q.id, checked: i === 0 }), ' ' + q.title));
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'פתיחת התיק');
  return el('form', { class: 'card new-case', onsubmit: async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    await withBusy(btn, async () => {
      const res = await api('caseOpen', { name: name.value, email: email.value, gender: g.value(), phone: phone.value, group: group.value,
        open: qs.map(l => l.querySelector('input')).filter(x => x.checked).map(x => x.value) });
      if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
      cacheDrop('list');
      showClient(res.email);
    });
  } },
    el('h2', {}, 'תיק חדש'),
    el('p', { class: 'hint' }, 'אחרי הפתיחה, הנועץ/ת נרשם/ת באתר הנועצים עם אותו אימייל, ומקבל/ת קוד כניסה כרגיל. השאלונים שסימנת כבר יהיו פתוחים.'),
    el('div', { class: 'grid2' }, field('שם מלא', name), field('אימייל', email), field('טלפון (לא חובה)', phone), field('קבוצה', group)),
    el('div', { class: 'field' }, el('span', {}, 'נועצת או נועץ'), g.node),
    qs.length ? el('div', { class: 'field' }, el('span', {}, 'שאלונים פתוחים מההתחלה'), el('div', { class: 'checks' }, qs)) : null,
    msg, el('div', { class: 'row' }, btn));
}

function radios(name, opts, value) {
  const node = el('div', { class: 'radios', role: 'radiogroup' }, opts.map(([v, l]) =>
    el('label', { class: 'check' }, el('input', { type: 'radio', name: name, value: v, checked: v === value }), ' ' + l)));
  return { node: node, value: () => { const c = node.querySelector('input:checked'); return c ? c.value : ''; } };
}

function select(id, opts, value) {
  return el('select', { id: id }, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
}

let onlyMine = false, clientSort = 'seen';
const GENDER_WORD = { f: 'נועצת', m: 'נועץ' };
// "היום 14:05" / "אתמול" / "3.10.2026"
function fmtWhen(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(s || ''));
  if (!m) return String(s || '');
  const d = new Date(+m[1], +m[2] - 1, +m[3]), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const days = Math.round((t0 - d) / 86400000);
  if (days === 0) return 'היום' + (m[4] ? ' ' + m[4] : '');
  if (days === 1) return 'אתמול' + (m[4] ? ' ' + m[4] : '');
  return (+m[3]) + '.' + (+m[2]) + '.' + m[1];
}
const QCHIPS = 6; // more than this: "+N", the rest in the tooltip

function drawClients(r, refresh) {
  const hadFocus = refresh && document.activeElement && document.activeElement.classList.contains('search');
  const y = window.scrollY;
  const groupShort = v => { const g = (r.groups || []).filter(x => x[0] === v)[0]; return g ? g[1].split(' · ')[0] : ''; };
  const search = el('input', { type: 'search', class: 'search', placeholder: 'חיפוש לפי שם, אימייל, תגית או יועץ', value: clientSearch, 'aria-label': 'חיפוש נועץ' });
  const mine = el('input', { type: 'checkbox', id: 'onlyMine', checked: onlyMine });
  const sort = select('clientSort', [['seen', 'מיון: כניסה אחרונה'], ['created', 'מיון: הרשמה'], ['name', 'מיון: שם']], clientSort);
  sort.setAttribute('aria-label', 'מיון');
  const tableBox = el('div');
  const count = el('p', { class: 'muted small' });

  const chips = c => {
    const qs = c.qs || [];
    if (!qs.length) return el('span', { class: 'muted small' }, 'אין שאלונים פתוחים');
    const shown = qs.slice(0, QCHIPS), rest = qs.slice(QCHIPS);
    const all = qs.map(q => (q.done ? '✓ ' : '○ ') + q.title).join('\n');
    return el('span', { class: 'qchips', title: all },
      shown.map(q => el('span', { class: 'qchip' + (q.done ? ' done' : '') },
        el('span', { class: 'dot', 'aria-label': q.done ? 'מולא' : 'טרם מולא' }), q.title)),
      rest.length ? el('span', { class: 'qchip more' }, '+' + rest.length) : null);
  };

  function draw() {
    const q = search.value.trim().toLowerCase();
    clientSearch = search.value; onlyMine = mine.checked; clientSort = sort.value;
    let list = r.clients.filter(c => (!onlyMine || c.staff === r.myEmail) && (!q || (c.name || '').toLowerCase().includes(q) || c.email.includes(q) ||
      (c.staffName || '').toLowerCase().includes(q) || (c.tags || []).some(x => x.toLowerCase().includes(q))));
    const key = c => clientSort === 'seen' ? (c.lastSeen || '') : clientSort === 'created' ? (c.created || '') : '';
    list = list.slice().sort((a, b) => clientSort === 'name' ? (a.name || '').localeCompare(b.name || '', 'he') :
      key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0);
    const base = onlyMine ? r.clients.filter(c => c.staff === r.myEmail).length : r.clients.length;
    count.textContent = (list.length === base ? base : list.length + ' מתוך ' + base) + ' נועצים' + (onlyMine ? ' שלי' : '');
    if (!list.length) { tableBox.replaceChildren(el('p', { class: 'muted' }, r.clients.length ? 'אין תוצאות.' : 'עדיין אין נועצים רשומים.')); return; }
    const rows = list.map(c => {
      const done = (c.qs || []).filter(x => x.done).length;
      return el('tr', { class: 'clickable', tabindex: '0',
        onmouseenter: () => loadAhead(c.email), onfocus: () => loadAhead(c.email),
        onclick: () => showClient(c.email),
        onkeydown: (e) => { if (e.key === 'Enter') showClient(c.email); } },
        el('td', { class: 'who' }, el('b', {}, c.name || '—'),
          c.registered === false ? el('span', { class: 'badge wait not-reg' }, 'טרם נרשם/ה') :
            c.privacy === false ? el('span', { class: 'badge wait' }, 'טרם אישר/ה פרטיות') : null,
          el('div', { class: 'list-meta' }, [GENDER_WORD[c.gender], groupShort(c.group), c.age ? 'גיל ' + c.age : ''].concat(c.tags || []).filter(Boolean).join(' · ')),
          el('div', { class: 'list-meta mail', dir: 'ltr' }, c.email)),
        el('td', { class: 'staff-cell' }, c.staffName ? el('span', { class: c.staff === r.myEmail ? 'mine' : '' }, c.staff === r.myEmail ? 'אני' : c.staffName) : el('span', { class: 'muted' }, '—')),
        el('td', { class: 'seen' }, c.registered === false ? el('span', { class: 'muted' }, '—') : c.lastSeen ? fmtWhen(c.lastSeen) : el('span', { class: 'muted small' }, 'נרשם/ה ' + fmtWhen(c.created))),
        el('td', { class: 'qs-cell' }, (c.qs || []).length ? el('span', { class: 'count' + (done ? ' some' : '') }, done + '/' + c.qs.length) : null, chips(c)),
        el('td', { class: 'next-cell' }, c.next && c.next.date ? el('span', {}, 'פגישה ' + c.next.n + ' · ' + fmtDay(c.next.date) + (c.next.time ? ' · ' + c.next.time : '')) :
          c.next ? el('span', { class: 'muted small' }, 'פגישה ' + c.next.n + ' · לא נקבע') : el('span', { class: 'muted small' }, 'הפגישות הסתיימו')));
    });
    tableBox.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'staff clients' },
      el('thead', {}, el('tr', {}, el('th', {}, 'נועץ/ת'), el('th', {}, 'יועץ/ת'), el('th', {}, 'כניסה אחרונה'),
        el('th', {}, 'שאלונים', el('span', { class: 'muted small th-hint' }, ' · ', el('span', { class: 'dot inline' }), ' מולא')), el('th', {}, 'הפגישה הבאה'))),
      el('tbody', {}, rows))));
  }
  search.addEventListener('input', draw); mine.addEventListener('change', draw); sort.addEventListener('change', draw);
  draw();

  render(menu('clients'),
    el('div', { class: 'title-row' }, el('h1', {}, 'נועצים'), newCaseButton(r)),
    el('p', { class: 'sub' }, 'בחרו נועץ/ת כדי לפתוח את התיק.'),
    newCaseBox,
    el('div', { class: 'card' }, el('div', { class: 'list-tools' }, search, el('label', { class: 'check' }, mine, ' רק שלי'), sort), count, tableBox));
  if (refresh) { window.scrollTo(0, y); if (hadFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); } }
}

// ---------- one client ----------
async function showClient(email) {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  const key = 'client_' + email;
  const cached = cacheGet(key);
  if (cached) drawClient(cached); else { loading('clients'); window.scrollTo(0, 0); }
  const r = await (takeAhead(email) || api('clientGet', { email: email }));
  if (seq !== viewSeq) return;
  if (!r.ok) { if (!r.handled && !cached) render(menu('clients'), backLink(), msgBox(r.message)); return; }
  cachePut(key, r);
  if (!cached || !same(cached, r)) drawClient(r, !!cached);
}

let currentClient = null; // the email of the תיק on screen (refreshed when you come back to this tab)
let caseTab = 'meet';

function drawClient(r, refresh) {
  const y = window.scrollY;
  const c = r.client;
  const ci = r.caseInfo || {};
  const L = r.lists || { groups: [], kinds: [], noteKinds: [], meets: [] };
  currentClient = c.email;
  const sentCount = r.questionnaires.filter(q => q.sentAt).length;
  // as in Nurit's page: questionnaires for other groups only (e.g. retirement) are tucked away, unless open or sent
  const fits = q => !(q.groups && q.groups.length) || q.groups.indexOf(ci.group) !== -1 || q.sentAt || q.open;
  const blocks = r.questionnaires.filter(fits).map(q => questionnaireRow(q, c));
  const others = r.questionnaires.filter(q => !fits(q));
  const label = (list, v) => { const x = (list || []).filter(i => i[0] === v)[0]; return x ? x[1] : ''; };
  const genderWord = c.gender === 'f' ? 'נועצת' : c.gender === 'm' ? 'נועץ' : '';
  const facts = [genderWord, label(L.groups, ci.group), ci.fac, ci.age ? 'גיל ' + ci.age : '', ci.years ? ci.years + ' שנות ניסיון' : '']
    .concat(ci.tags || []).filter(Boolean);
  currentReminders = (r.entries && r.entries.reminders) || {};
  const intake = r.questionnaires.filter(q => q.id === 'intake' && q.state)[0];
  const suggested = !ci.group && intake ? groupFromIntake(intake.state) : '';

  const tabs = { meet: 'הפגישות', claude: 'Claude', notes: 'הרשמים שלי' };
  const tabBox = el('div', { class: 'case-tab' });
  const tabBtns = Object.keys(tabs).map(k => el('button', { type: 'button', class: 'tab' + (k === caseTab ? ' on' : ''), 'data-tab': k,
    'aria-pressed': k === caseTab ? 'true' : 'false', onclick: () => { caseTab = k; drawTab(); } }, tabs[k] +
    (k === 'notes' && r.entries && r.entries.notes.length ? ' (' + r.entries.notes.length + ')' : '')));
  function drawTab() {
    tabBtns.forEach(b => { const on = b.dataset.tab === caseTab; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    tabBox.replaceChildren(caseTab === 'notes' ? notesSection(r) : caseTab === 'meet' ? meetingsSection(r) : claudeSection(r));
  }
  drawTab();

  // text being written survives a refresh of the page (the note, and the meeting fields)
  const drafts = {};
  if (refresh) document.querySelectorAll('textarea[data-keep]').forEach(x => { if (x.value !== x.defaultValue) drafts[x.id] = x.value; });
  render(menu('clients'), backLink(),
    el('h1', {}, c.name || c.email),
    el('p', { class: 'sub case-facts' }, facts.join(' · ') || 'עוד אין פרטים'),
    el('p', { class: 'muted small case-contact' }, ci.staff ? el('span', { class: 'case-staff' }, 'יועץ/ת מלווה: ' + (label(L.staff, ci.staff) || ci.staff) + ' · ') : null,
      el('span', { dir: 'ltr' }, c.email), ci.phone ? el('span', {}, ' · ', el('span', { dir: 'ltr' }, ci.phone)) : null,
      c.registered === false ? el('span', { class: 'badge wait not-reg' }, 'טרם נרשם/ה לאתר') : ' · נרשם/ה ' + (c.created || '—'),
      ci.consent ? ' · הסכמה לשמירת מידע ' + ci.consentAt : '',
      ci.privacyAt ? ' · אישר/ה את מדיניות הפרטיות ' + ci.privacyAt : (c.registered === false ? '' : ' · טרם אישר/ה את מדיניות הפרטיות')),
    caseDetails(r, L),
    !ci.group ? el('div', { class: 'card group-pick' }, el('b', {}, 'קבוצה: '), el('span', { class: 'muted' }, suggested ? 'הצעה לפי שאלון הכניסה: ' : 'עוד לא נבחרה. '),
      el('div', { class: 'row' }, L.groups.map(([v, l]) => el('button', { type: 'button', class: 'btn small ' + (v === suggested ? 'primary' : 'secondary'),
        onclick: () => saveCase(c.email, { group: v }) }, l.split(' · ').slice(0, 2).join(' · '))))) : null,
    el('h2', { class: 'section-title' }, 'השאלונים', el('span', { class: 'muted small' }, ' · ' + sentCount + ' מתוך ' + r.questionnaires.length + ' נשלחו')),
    openMailRow(r),
    blocks.length ? el('div', { class: 'qlist' }, blocks) : el('p', { class: 'muted' }, 'אין עדיין שאלונים במערכת.'),
    others.length ? el('details', { class: 'more-q' }, el('summary', {}, 'שאלונים נוספים, לקבוצות אחרות (' + others.length + ')'),
      el('div', { class: 'qlist' }, others.map(q => questionnaireRow(q, c)))) : null,
    cvRow(r.cv, c),
    el('div', { class: 'tabs', role: 'group', 'aria-label': 'חלקי התיק' }, tabBtns),
    tabBox);
  Object.keys(drafts).forEach(id => { const x = document.getElementById(id); if (x) x.value = drafts[id]; });
  window.scrollTo(0, refresh ? y : 0);
}

// Group 1א… from the first answer of שאלון הכניסה (as the "תיקי נועצים" page did); the יועץ confirms it
function groupFromIntake(state) {
  const q1 = state && state.a ? state.a.q1 : null;
  if (q1 === null || q1 === undefined) return '';
  return q1 === 4 ? '3a' : q1 === 5 ? '3b' : q1 === 0 ? '' : '2';
}

const fmtDay = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? (+m[3]) + '.' + (+m[2]) + '.' + m[1] : String(d || ''); };
let currentReminders = {};

// ---------- the meetings: what was filled before each, what was said and decided, what to fill next ----------
const ORD = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית', 'שביעית', 'שמינית', 'תשיעית', 'עשירית', 'אחת־עשרה', 'שתים־עשרה'];
const MEET_MAX = 12;
const MEET_TEXT = [['summary', 'סיכום הפגישה', 'מה עלה? מה הרגשת?'], ['decisions', 'החלטות והמשך', 'מה סוכם, ומה הכיוון להמשך'],
  ['task', 'משימה לנועץ/ת', 'מה הנועץ/ת עושה עד הפגישה הבאה']];
let meetSel = {}, meetFlash = null; // the meeting on screen per תיק; the message after a save

function meetingsOf(r) {
  const ms = ((r.caseInfo || {}).meetings || []).map(m => Object.assign({ done: false, date: '', time: '', given: [] }, m));
  while (ms.length < 4) ms.push({ done: false, date: '', time: '', given: [] });
  return ms;
}

function meetingsSection(r) {
  const c = r.client, ms = meetingsOf(r);
  const nextI = ms.findIndex(m => !m.done);
  let n = meetSel[c.email];
  if (!n || n > ms.length) n = nextI === -1 ? ms.length : nextI + 1;
  const strip = el('div', { class: 'mtg-strip', role: 'group', 'aria-label': 'הפגישות' },
    ms.map((m, i) => el('button', { type: 'button', 'data-n': String(i + 1),
      class: 'mtg-pill' + (m.done ? ' done' : '') + (i === nextI ? ' next' : '') + (i + 1 === n ? ' on' : ''),
      'aria-pressed': i + 1 === n ? 'true' : 'false', title: m.date ? fmtDay(m.date) + (m.time ? ' · ' + m.time : '') : '',
      onclick: () => { meetSel[c.email] = i + 1; meetFlash = null; drawClient(r, true); } },
      el('span', { class: 'mtg-n' }, m.done ? '✓' : String(i + 1)),
      el('span', { class: 'mtg-pl' }, i === nextI ? 'הבאה' + (m.date ? ' · ' + fmtDay(m.date) : '') : m.done ? (m.date ? fmtDay(m.date) : 'התקיימה') : (m.date ? fmtDay(m.date) : '')))),
    ms.length < MEET_MAX ? el('button', { type: 'button', class: 'link-btn small mtg-add', onclick: async (e) => {
      const res = await withBusy(e.currentTarget, () => api('meetSave', { email: c.email, n: ms.length + 1, given: [] }));
      if (!res.ok) return;
      meetSel[c.email] = ms.length + 1; afterMeetSave(r, res);
    } }, '+ פגישה נוספת') : null);
  return el('div', { class: 'meet-sec' }, strip, meetingCard(r, ms, n));
}

function afterMeetSave(r, res) {
  r.caseInfo = Object.assign({}, r.caseInfo, res.caseInfo); r.entries = res.entries;
  (res.opened || []).forEach(id => r.questionnaires.forEach(q => { if (q.id === id) q.open = true; }));
  cachePut('client_' + r.client.email, r); cacheDrop('list');
  drawClient(r, true);
}

function meetingCard(r, ms, n) {
  const c = r.client, m = ms[n - 1], E = r.entries || {}, T = (E.meetTexts || {})[n] || {};
  const byId = {}; r.questionnaires.forEach(q => { byId[q.id] = q; });
  const msg = el('div', { class: 'mtg-msg', 'aria-live': 'polite' });
  const done = el('input', { type: 'checkbox', id: 'm_done', checked: m.done });
  const date = el('input', { type: 'date', id: 'm_date', value: m.date || '', 'aria-label': 'תאריך' });
  const time = el('input', { type: 'time', id: 'm_time', value: m.time || '', 'aria-label': 'שעה' });

  // what was filled for this meeting: what was decided at the one before (for the first: all that was open)
  const prev = n > 1 ? ms[n - 2] : null;
  const forThis = prev ? prev.given.map(id => byId[id]).filter(Boolean) : r.questionnaires.filter(q => q.open || q.sentAt);
  const filled = el('div', { class: 'mtg-part' }, el('h4', {}, 'מה מולא לקראת הפגישה'),
    forThis.length ? el('ul', { class: 'mtg-qs' }, forThis.map(q => el('li', { class: q.sentAt ? 'done' : '' },
      el('span', { class: 'dot' }), el('span', { class: 'qt' }, q.title),
      q.sentAt ? el('span', { class: 'muted small' }, ' · ' + fmtWhen(q.sentAt)) : el('span', { class: 'badge wait' }, q.open ? 'טרם נשלח' : 'סגור · טרם נשלח'),
      q.sentAt ? el('button', { type: 'button', class: 'link-btn small', onclick: () => openAnswers(q, c) }, 'צפייה בתשובות') : null)))
      : el('p', { class: 'muted small' }, prev ? 'בפגישה ה' + ORD[n - 2] + ' לא נבחרו שאלונים.' : 'עוד לא נפתחו שאלונים.'));

  const areas = MEET_TEXT.map(([f, lab, ph]) => {
    const x = el('textarea', { id: 'm_' + f, 'data-keep': '1', rows: f === 'summary' ? '5' : '3', placeholder: ph }, (T[f] || {}).text || '');
    return el('label', { class: 'field mtg-text' }, el('span', {}, lab,
      T[f] && T[f].text ? el('span', { class: 'muted small by' }, ' · ' + (T[f].byName || '') + ', ' + fmtWhen(T[f].at)) : null), x);
  });

  // the questionnaires to fill before the next meeting (saving opens them for the נועץ)
  const ci = r.caseInfo || {};
  const fits = q => !(q.groups && q.groups.length) || q.groups.indexOf(ci.group) !== -1 || m.given.indexOf(q.id) !== -1;
  const giveBox = q => el('label', { class: 'check' + (q.sentAt ? ' was-sent' : '') },
    el('input', { type: 'checkbox', value: q.id, checked: m.given.indexOf(q.id) !== -1 }), ' ' + q.title,
    q.sentAt ? el('span', { class: 'muted small' }, ' (כבר מולא)') : q.open && m.given.indexOf(q.id) === -1 ? el('span', { class: 'muted small' }, ' (פתוח)') : null);
  const otherQs = r.questionnaires.filter(q => q.id && !fits(q));
  const nextPart = el('div', { class: 'mtg-part' }, el('h4', {}, 'שאלונים לפגישה הבאה'),
    el('p', { class: 'hint' }, 'מה שמסמנים נפתח לנועץ/ת בשמירה.'),
    el('div', { class: 'checks' }, r.questionnaires.filter(q => q.id && fits(q)).map(giveBox)),
    otherQs.length ? el('details', { class: 'more-give' }, el('summary', { class: 'small' }, 'שאלונים לקבוצות אחרות (' + otherQs.length + ')'),
      el('div', { class: 'checks' }, otherQs.map(giveBox))) : null);

  const old = ((E.notes || []).filter(x => x.sub === 'סיכום פגישה ' + ORD[n - 1]));
  const oldPart = old.length ? el('details', { class: 'mtg-old' }, el('summary', {}, 'סיכום קודם מ"הרשמים שלי" (' + old.length + ')'),
    old.map(x => el('div', { class: 'note' }, el('div', { class: 'note-head' }, el('span', { class: 'muted small' }, x.at + ' · ' + x.byName)), el('div', { class: 'note-text' }, x.text)))) : null;

  if (meetFlash && meetFlash.email === c.email && meetFlash.n === n) {
    msg.append(el('span', { class: 'saved-note' }, meetFlash.text));
    if (meetFlash.opened.length) {
      const mb = el('button', { type: 'button', class: 'btn secondary small', onclick: async () => {
        const res = await withBusy(mb, () => api('mailOpened', { email: c.email }));
        if (!res.ok) { if (!res.handled) msg.replaceChildren(msgBox(res.message || 'המייל לא נשלח')); return; }
        meetFlash = null; cacheDrop('client_' + c.email);
        msg.replaceChildren(el('span', { class: 'saved-note' }, 'נשלח מייל על: ' + res.sentAbout.join(', ')));
      } }, 'שליחת מייל לנועץ על השאלונים הפתוחים');
      msg.append(' ', mb);
    }
  }

  const save = el('button', { type: 'button', class: 'btn primary', id: 'm_save', onclick: async () => {
    msg.replaceChildren();
    const texts = {}; MEET_TEXT.forEach(([f]) => { texts[f] = document.getElementById('m_' + f).value; });
    const given = [...nextPart.querySelectorAll('input:checked')].map(x => x.value);
    const res = await withBusy(save, () => api('meetSave', { email: c.email, n: n, done: done.checked, date: date.value, time: time.value, given: given, texts: texts }));
    if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
    const titles = (res.opened || []).map(id => (byId[id] || {}).title || id);
    meetSel[c.email] = n; // stay on this meeting after the save
    meetFlash = { email: c.email, n: n, opened: res.opened || [], text: 'נשמר' + (titles.length ? '. נפתחו לנועץ/ת: ' + titles.join(', ') : '') };
    MEET_TEXT.forEach(([f]) => { const x = document.getElementById('m_' + f); if (x) x.defaultValue = x.value; });
    afterMeetSave(r, res);
  } }, 'שמירת הפגישה');

  return el('div', { class: 'card mtg-card' + (m.done ? ' done' : '') },
    el('div', { class: 'mtg-head' }, el('h3', {}, 'פגישה ' + (ORD[n - 1] || n)),
      el('span', { class: 'mtg-when' }, el('label', { class: 'check' }, done, ' התקיימה'), date, time)),
    filled,
    areas,
    nextPart,
    oldPart,
    el('div', { class: 'row' }, save, msg));
}

// ---------- emails to the נועץ ----------
function openMailRow(r) {
  const c = r.client, E = r.entries || {};
  const openUnsent = r.questionnaires.filter(q => q.open && !q.sentAt).length;
  const note = el('span', { class: 'muted small', 'aria-live': 'polite' }, E.openMail ? 'מייל אחרון על שאלונים פתוחים: ' + E.openMail : '');
  const btn = el('button', { type: 'button', class: 'btn secondary small open-mail', disabled: !openUnsent, onclick: async () => {
    const res = await withBusy(btn, () => api('mailOpened', { email: c.email }));
    if (!res.ok) { if (!res.handled) note.textContent = res.message || 'המייל לא נשלח'; return; }
    note.textContent = 'נשלח מייל על: ' + res.sentAbout.join(', ');
    cacheDrop('client_' + c.email);
  } }, 'שליחת מייל לנועץ על השאלונים הפתוחים' + (openUnsent ? ' (' + openUnsent + ')' : ''));
  return el('div', { class: 'row open-mail-row' }, btn, note);
}

async function saveCase(email, fields, msgEl) {
  const res = await api('caseSave', { email: email, fields: fields });
  if (!res.ok) { if (!res.handled && msgEl) msgEl.replaceChildren(msgBox(res.message)); return false; }
  cacheDrop('client_' + email); cacheDrop('list');
  showClient(email);
  return true;
}

// "עריכת פרטים": name, לשון, phone, group, tags, consent…
function caseDetails(r, L) {
  const c = r.client, ci = r.caseInfo || {};
  const msg = el('div');
  const inp = (id, v, type, dir) => el('input', { type: type || 'text', id: id, value: v || '', dir: dir || null });
  const f = {
    name: inp('c_name', c.name), phone: inp('c_phone', ci.phone, 'tel', 'ltr'), fac: inp('c_fac', ci.fac),
    tags: inp('c_tags', (ci.tags || []).join(', ')), age: inp('c_age', ci.age), years: inp('c_years', ci.years),
    gender: select('c_gender', [['f', 'נועצת'], ['m', 'נועץ']], c.gender || 'f'),
    kind: select('c_kind', [['', 'לא נבחר']].concat(L.kinds), ci.kind || ''),
    group: select('c_group', [['', 'לא נבחרה']].concat(L.groups), ci.group || ''),
    note: el('textarea', { id: 'c_note', rows: '3' }, ci.note || ''),
    consent: el('input', { type: 'checkbox', id: 'c_consent', checked: !!ci.consent }),
    staff: select('c_staff', [['', 'לא נבחר/ה']].concat(ci.staff && !(L.staff || []).some(s => s[0] === ci.staff) ? [[ci.staff, ci.staff]] : []).concat(L.staff || []), ci.staff || '')
  };
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'שמירת הפרטים');
  return el('details', { class: 'case-edit' }, el('summary', {}, 'עריכת פרטים'),
    el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      await withBusy(btn, () => saveCase(c.email, { name: f.name.value, gender: f.gender.value, phone: f.phone.value, fac: f.fac.value,
        tags: f.tags.value, age: f.age.value, years: f.years.value, kind: f.kind.value, group: f.group.value, note: f.note.value,
        consent: f.consent.checked, staff: f.staff.value }, msg));
    } },
      el('div', { class: 'grid2' }, field('שם', f.name), field('יועץ/ת מלווה', f.staff), field('נועצת או נועץ', f.gender), field('טלפון', f.phone), field('מי זה/זו', f.kind),
        field('קבוצה', f.group), field('תחום / פקולטה', f.fac), field('תגיות (מפרידים בפסיק)', f.tags),
        el('div', { class: 'grid2' }, field('גיל', f.age), field('שנות ניסיון', f.years))),
      field('הערה כללית', f.note),
      el('label', { class: 'check consent' }, f.consent, ' הנועץ/ת הסכים/ה שהמידע יישמר בתיק' + (ci.consentAt ? ' (' + ci.consentAt + ')' : '')),
      msg, el('div', { class: 'row' }, btn)));
}

// ---------- "הרשמים שלי" ----------
function notesSection(r) {
  const c = r.client, L = r.lists, notes = (r.entries && r.entries.notes) || [];
  const msg = el('div');
  const kinds = L.noteKinds.filter(k => k !== 'סיכום פגישה');
  const kind = radios('n_kind', kinds.map(k => [k, k]), kinds[0]);
  const meetsDone = notes.filter(n => /^סיכום פגישה/.test(n.sub)).length;
  const meet = select('n_meet', L.meets.map(m => [m, m]), L.meets[Math.min(meetsDone, L.meets.length - 1)]);
  const meetBox = el('div', { class: 'field meet', hidden: true }, el('span', {}, 'איזו פגישה?'), meet,
    el('p', { class: 'hint' }, 'מצב השאלונים עד היום נכנס לסיכום אוטומטית.'));
  const text = el('textarea', { id: 'n_text', 'data-keep': '1', rows: '5', placeholder: 'מה עלה? מה הרגשת? מה סוכם?' });
  kind.node.addEventListener('change', () => { meetBox.hidden = kind.value() !== 'סיכום פגישה'; });
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'שמירה');
  const list = notes.length ? notes.map(n => el('div', { class: 'note' },
    el('div', { class: 'note-head' }, el('b', {}, n.sub || 'הערה'), el('span', { class: 'muted small' }, n.at + ' · ' + n.byName),
      n.by === (me && me.email) ? el('button', { type: 'button', class: 'link-btn small del', onclick: async (e) => {
        const b = e.currentTarget;
        if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'לחיצה נוספת תמחק'; return; }
        const res = await api('noteDelete', { email: c.email, id: n.id });
        if (!res.ok) { if (!res.handled) msg.replaceChildren(msgBox(res.message)); return; }
        cacheDrop('client_' + c.email); showClient(c.email);
      } }, 'מחיקה') : null),
    el('div', { class: 'note-text' }, n.text))) : [el('p', { class: 'muted' }, 'עוד אין רשמים. אחרי פגישה, כתבו כאן מה עלה.')];
  return el('div', {},
    el('form', { class: 'card note-form', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if (!text.value.trim()) { msg.append(msgBox('הרושם ריק.')); return; }
      await withBusy(btn, async () => {
        const res = await api('noteAdd', { email: c.email, kind: kind.value(), meet: meet.value, text: text.value });
        if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
        cacheDrop('client_' + c.email); showClient(c.email);
      });
    } }, el('h3', {}, 'רושם חדש'), kind.node, meetBox, text, msg, el('div', { class: 'row' }, btn)),
    el('div', { class: 'notes' }, list));
}

// ---------- Claude: the conversations and the feedback draft, and the button that opens the Claude page ----------
function claudeSection(r) {
  const c = r.client, E = r.entries || { threads: [], feedback: null };
  const msg = el('div', { 'aria-live': 'polite' });
  const btn = el('button', { type: 'button', class: 'btn primary', id: 'openClaude', onclick: () => openInClaude(c, r.claudeUrl, btn, msg) }, 'פתיחה ב-Claude');
  const refresh = el('button', { type: 'button', class: 'btn secondary small', onclick: async () => {
    await withBusy(refresh, () => api('caseSync'));
    cacheDrop('client_' + c.email); showClient(c.email);
  } }, 'רענון');
  const threads = (E.threads || []).slice().reverse();
  const last = threads[0];
  const head = el('div', { class: 'card claude-head' },
    el('div', { class: 'row spread' }, el('div', {},
      el('h3', {}, 'ניתוח וירטואלי ומשוב לנועץ'),
      el('p', { class: 'muted small' }, 'נפתח בדף Claude שלך, עם כל מה שבתיק. כל תשובה של Claude נשמרת כאן בתיק.')),
      el('div', { class: 'row' }, btn, refresh)),
    r.claudeUrl ? null : el('p', { class: 'warn small' }, 'עוד לא הוגדר הקישור לדף Claude שלך. ', el('button', { type: 'button', class: 'link-btn', onclick: () => showSettings() }, 'להגדרות')),
    msg);
  const fb = E.feedback;
  const sent = E.sentFeedback || [];
  const fbCard = fb ? feedbackCard(c, fb, sent) : null;
  const convo = th => el('div', { class: 'thread' }, th.messages.map(m => el('div', { class: 'bub ' + (m.role === 'me' ? 'me' : 'ai') },
    el('div', { class: 'who' }, (m.role === 'me' ? m.byName : m.role === 'summary' ? 'סיכום שיחה קודמת' : 'Claude') + ' · ' + m.at),
    el('div', { class: 'md' }, md(m.text)))));
  return el('div', {}, head,
    last ? el('div', {}, el('h3', { class: 'sub-title' }, 'השיחה האחרונה'), convo(last)) : el('p', { class: 'muted' }, 'עוד אין ניתוחים בתיק הזה.'),
    threads.length > 1 ? el('details', { class: 'older' }, el('summary', {}, 'שיחות קודמות (' + (threads.length - 1) + ')'),
      threads.slice(1).map(convo)) : null,
    fbCard);
}

// The feedback draft (from Claude, or as corrected there): read it, adjust it here if needed, and send it to the נועץ
function feedbackCard(c, fb, sent) {
  const already = sent.length && sent[0].text === fb.text;
  const ta = el('textarea', { class: 'fb-edit', rows: '14', 'aria-label': 'נוסח המשוב' }); ta.value = fb.text;
  const msg = el('span', { class: 'saved-note', 'aria-live': 'polite' }, already ? 'הנוסח הזה כבר נשלח לנועץ ב-' + sent[0].at : '');
  let armed = false;
  const send = el('button', { type: 'button', class: 'btn primary small fb-send', onclick: async () => {
    if (!ta.value.trim()) { msg.textContent = 'המשוב ריק.'; return; }
    if (!armed) { armed = true; send.textContent = 'לשלוח במייל ל' + (c.name || c.email) + '? לחיצה נוספת שולחת'; return; }
    const res = await withBusy(send, () => api('fbSend', { email: c.email, text: ta.value }));
    armed = false; send.textContent = 'שליחה לנועץ';
    if (!res.ok) { if (!res.handled) msg.textContent = res.message || 'המשוב לא נשלח'; return; }
    msg.textContent = 'המשוב נשלח לנועץ במייל, ונשמר גם בעמוד הראשי שלו באתר.';
    cacheDrop('client_' + c.email);
  } }, 'שליחה לנועץ');
  return el('div', { class: 'card fb' },
    el('div', { class: 'row spread' }, el('h3', {}, 'משוב לנועץ · ' + (fb.sub === 'me' ? 'הגרסה שתוקנה' : 'הטיוטה של Claude')),
      el('span', { class: 'muted small' }, fb.at + ' · ' + fb.byName)),
    el('p', { class: 'muted small' }, 'אפשר לתקן כאן לפני השליחה. הנועץ יקבל את המשוב במייל, והוא יישמר גם בעמוד הראשי שלו באתר.'),
    ta,
    el('div', { class: 'row' }, send, copyRow(fb.text), msg),
    sent.length ? el('details', { class: 'fb-sent' }, el('summary', {}, 'נשלח לנועץ (' + sent.length + ')'),
      sent.map(s => el('div', { class: 'fb-sent-item' }, el('div', { class: 'muted small' }, s.at + ' · ' + s.byName), el('div', { class: 'fb-text' }, s.text)))) : null);
}

function copyRow(text) {
  const done = el('span', { class: 'copied', 'aria-live': 'polite' });
  return el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn secondary small', onclick: async () => {
    done.textContent = (await copyText(text)) ? 'הועתק' : 'ההעתקה לא הצליחה';
    setTimeout(() => { done.textContent = ''; }, 2200);
  } }, 'העתקה'), done);
}

// Prepares the תיק for Claude, then opens the Claude page on it. The new tab is opened at the click
// (browsers block tabs opened later), and pointed at the page once the תיק is ready.
async function openInClaude(c, url, btn, msg) {
  msg.replaceChildren();
  if (!url) { msg.append(msgBox('קודם צריך להגדיר את הקישור לדף Claude שלך, בהגדרות.')); return; }
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (w) { try { w.document.title = 'מכינים את התיק…'; w.document.body.textContent = 'מכינים את התיק ל-Claude…'; } catch (e) { } }
  let res;
  await withBusy(btn, async () => { res = await api('claudePrepare', { email: c.email }); });
  if (!res || !res.ok) {
    if (w) w.close();
    if (res && !res.handled) msg.append(msgBox(res.message));
    return;
  }
  const link = (res.url || url) + '#' + res.req;
  if (w) { try { w.opener = null; w.location.href = link; } catch (e) { w = null; } }
  msg.append(el('p', { class: 'small' }, w ? 'נפתח בלשונית חדשה. ' : 'הדף מוכן: ',
    el('a', { href: link, target: '_blank', rel: 'noopener', class: 'claude-link' }, w ? 'לא נפתח? לחצו כאן' : 'פתיחה ב-Claude'),
    '. כשחוזרים ללשונית הזו, התיק מתעדכן לבד.'));
}

// Claude writes ## headings, **bold**, lists – shown as such (the text is escaped first)
function md(t) {
  const box = el('div');
  let list = null;
  String(t || '').split('\n').forEach(line => {
    const L = line.trim();
    const inline = (s) => {
      const span = el('span');
      s.split(/(\*\*[^*]+\*\*)/).forEach(part => {
        if (/^\*\*[^*]+\*\*$/.test(part)) span.append(el('b', {}, part.slice(2, -2)));
        else if (part) span.append(document.createTextNode(part.replace(/\*/g, '')));
      });
      return span;
    };
    if (/^#{1,4}\s/.test(L)) { list = null; box.append(el('h4', {}, inline(L.replace(/^#+\s*/, '')))); }
    else if (/^([-*•]|\d+[.)])\s+/.test(L)) {
      if (!list) { list = el('ul'); box.append(list); }
      list.append(el('li', {}, inline(L.replace(/^([-*•]|\d+[.)])\s+/, ''))));
    } else if (L) { list = null; box.append(el('p', {}, inline(L))); }
    else list = null;
  });
  return box;
}

// When you come back to this tab (from Claude), the תיק on screen is refreshed
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentClient && app.querySelector('.case-tab')) showClient(currentClient);
});

// One questionnaire on the נועץ page: title, the "פתוח למילוי / סגור" switch, status, and the answers button when sent
function questionnaireRow(q, client) {
  const row = el('div', { class: 'qblock' });
  const saved = el('span', { class: 'saved-note', 'aria-live': 'polite' });
  const input = el('input', { type: 'checkbox', role: 'switch', checked: q.open, 'aria-label': 'פתוח למילוי – ' + q.title });
  const swLabel = el('span', { class: 'switch-label' });
  const status = el('span', { class: 'qside' });

  function paint() {
    swLabel.textContent = q.open ? 'פתוח למילוי' : 'סגור';
    row.classList.toggle('pending', !q.sentAt);
    row.classList.toggle('closed', !q.open);
    const parts = [];
    if (q.sentAt) {
      parts.push(el('span', { class: 'badge sent' }, sentLabel(q)));
      if (!q.open) parts.push(el('span', { class: 'badge wait' }, 'לצפייה בלבד אצל הנועץ'));
      parts.push(el('button', { type: 'button', class: 'btn primary small open-answers', onclick: () => openAnswers(q, client) }, 'צפייה בתשובות'));
      if (q.id === 'intake' && q.state) parts.push(el('button', { type: 'button', class: 'btn secondary small open-analysis', onclick: () => openAnswers(q, client, 'analysis') }, 'ניתוח מלא'));
    } else {
      if (q.open) {
        parts.push(el('span', { class: 'badge wait' }, 'טרם נשלח'));
        const last = currentReminders[q.id];
        const rb = el('button', { type: 'button', class: 'btn secondary small remind', title: last ? 'תזכורת אחרונה: ' + last : '', onclick: async () => {
          const res = await withBusy(rb, () => api('remind', { email: client.email, id: q.id }));
          if (!res.ok) { if (!res.handled) saved.textContent = res.message || 'התזכורת לא נשלחה'; return; }
          currentReminders = res.entries.reminders || currentReminders;
          cacheDrop('client_' + client.email);
          saved.textContent = 'התזכורת נשלחה'; paint();
        } }, 'תזכורת');
        parts.push(rb);
        if (last) parts.push(el('span', { class: 'muted small last-remind' }, 'נשלחה ' + last));
      }
    }
    status.replaceChildren(...parts);
  }

  input.addEventListener('change', async () => {
    const want = input.checked;
    input.disabled = true; saved.textContent = 'שומר…';
    const r = await api('setAccess', { email: client.email, id: q.id, open: want });
    input.disabled = false;
    if (!r.ok) { input.checked = !want; saved.textContent = r.handled ? '' : (r.message || 'השמירה לא הצליחה'); return; }
    cacheDrop('client_' + client.email);
    q.open = want; paint();
    saved.textContent = want ? 'נפתח לנועץ' : 'נסגר לנועץ';
    setTimeout(() => { saved.textContent = ''; }, 2200);
  });

  row.append(el('div', { class: 'qhead' },
    el('span', { class: 'qtitle' }, q.title),
    el('span', { class: 'qcontrols' },
      el('label', { class: 'switch' }, input, el('span', { class: 'track' }), swLabel),
      saved, status)));
  paint();
  return row;
}

// קורות חיים: view (PDF opens in a popup) / download, fetched from the server for this signed-in יועץ
function cvRow(cv, client) {
  const note = el('span', { class: 'saved-note', 'aria-live': 'polite' });
  const head = el('div', { class: 'qhead' }, el('span', { class: 'qtitle' }, 'קורות חיים'));
  if (!cv) {
    head.append(el('span', { class: 'qside' }, el('span', { class: 'badge wait' }, 'לא הועלו')));
    return el('div', { class: 'cv-row pending' }, head);
  }

  async function fetchFile(btn) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'טוען…'; note.textContent = '';
    const r = await api('cvFile', { email: client.email });
    btn.disabled = false; btn.textContent = label;
    if (!r.ok) { if (!r.handled) note.textContent = r.message; return null; }
    const bin = atob(r.data); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { url: URL.createObjectURL(new Blob([bytes], { type: r.mime || 'application/octet-stream' })), name: r.name };
  }
  // צפייה opens the file in Google Drive (the folder is shared only with the יועצים list)
  const viewBtn = cv.url ? el('a', { class: 'btn primary small cv-view', href: cv.url, target: '_blank', rel: 'noopener' }, 'צפייה') : null;
  const dlBtn = el('button', { type: 'button', class: 'btn secondary small cv-download', onclick: async () => {
    const f = await fetchFile(dlBtn); if (!f) return;
    const a = el('a', { href: f.url, download: f.name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(f.url), 4000);
  } }, 'הורדה');
  head.append(el('span', { class: 'qside' }, note, el('span', { class: 'badge sent' }, el('bdi', {}, cv.name), ' · ' + cv.uploadedAt), viewBtn, dlBtn));
  return el('div', { class: 'cv-row' }, head);
}

function sentLabel(q) {
  return 'נשלח ' + q.sentAt + (q.updatedAt && q.updatedAt !== q.sentAt ? ' · עודכן ' + q.updatedAt : '');
}

// The answers of one questionnaire, in a popup over the page (closes with ✕, Esc or a click outside)
function openAnswers(q, client, start) {
  const dlg = el('dialog', { class: 'qmodal', 'aria-label': q.title + ' – ' + (client.name || client.email) });
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // a click on the dimmed area outside
  dlg.append(
    el('div', { class: 'mhead' },
      el('div', {}, el('div', { class: 'mtitle' }, q.title), el('div', { class: 'msub' }, (client.name || client.email) + ' · ' + sentLabel(q))),
      el('button', { type: 'button', class: 'mclose', 'aria-label': 'סגירה', onclick: close }, '✕')),
    answerViews(q, client, start));
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// גמישות בלמידה: tolerance for ambiguity, from 6 of the 50 statements (as in Nurit's page; for יועצים only)
const AMB = [[5, 0, 'נוח לי במצבים עמומים שאין בהם פתרון אחד ברור'], [9, 1, 'מתקשה להחליט כל עוד לא ברור כל המידע'],
  [22, 0, 'מתנדב/ת להוביל משימות שעוד לא הוגדרו'], [31, 0, 'משיג/ה יעדים גם באי־ודאות'],
  [32, 1, 'כשהכללים לא ברורים, מתקשה להפיק תוצאות'], [36, 1, 'כשמשימה נתקעת, ממתין/ה להנחיה מלמעלה']];
function ambRead(text) {
  text = String(text || '');
  const i = text.indexOf('הדירוגים המלאים');
  if (i < 0) return null;
  const sc = {};
  text.slice(i).replace(/^\s*(\d+)\.\s*(\d)\s*$/gm, (x, n, v) => { sc[+n] = +v; return x; });
  const it = AMB.map(([n, r, l]) => ({ n, r, l, raw: sc[n] || 0, v: sc[n] ? (r ? 7 - sc[n] : sc[n]) : null })).filter(x => x.v != null);
  if (it.length < 4) return null;
  const avg = it.reduce((a, x) => a + x.v, 0) / it.length;
  const m = a => a.length ? a.reduce((s, x) => s + x.v, 0) / a.length : null;
  const P = it.filter(x => !x.r), R = it.filter(x => x.r);
  const gap = (m(P) != null && m(R) != null) ? Math.abs(m(P) - m(R)) : 0;
  const lv = avg >= 4.8 ? 'גבוהה' : avg >= 3.3 ? 'בינונית' : 'נמוכה';
  const tx = lv === 'גבוהה' ? 'נוח לו/ה לפעול גם כשהתמונה לא ברורה. זה משאב משמעותי בצומת. כדאי לבדוק בשיחה אם זה נכון גם כשהעמימות נוגעת בו/ה אישית (פרנסה, זהות), ולא רק במשימות בעבודה.'
    : lv === 'בינונית' ? 'מתמודד/ת עם עמימות, אבל זה דורש מאמץ. כדאי לשאול: מה עוזר לך לפעול כשעוד לא הכול ברור? ומה עוצר אותך?'
      : 'עמימות מקשה עליו/ה לפעול. בצומת, שבה הרבה עוד לא ידוע, כדאי לבנות צעדים קטנים עם נקודות ביניים ברורות, ולהכיר בקושי בלי לשפוט אותו.';
  return { avg: +avg.toFixed(1), lv, tx, it, gap };
}
function ambCard(text) {
  const r = ambRead(text);
  if (!r) return null;
  return el('div', { class: 'card amb-card' },
    el('b', {}, 'סובלנות לעמימות (ליועצים בלבד): ' + r.avg + ' מתוך 6 · ' + r.lv),
    el('p', {}, r.tx),
    r.gap >= 2 ? el('p', { class: 'small amb-warn' }, 'שימו לב: התשובות לא עקביות. במשפטים החיוביים ובמשפטים ההפוכים התקבלה תמונה שונה. כדאי לברר בשיחה.') : null,
    el('details', {}, el('summary', { class: 'small' }, 'על מה זה נשען'),
      el('ul', { class: 'small' }, r.it.map(x => el('li', {}, x.l + ': ' + x.raw + ' מתוך 6' + (x.r ? ' (משפט הפוך)' : ''))))),
    el('p', { class: 'small muted' }, 'מדד שהרכבנו מ־6 משפטים בשאלון. הוא לא נבדק כמדד נפרד, ורוב המשפטים כתובים מנקודת מבט של מנהל/ת. השערה לשיחה, לא אבחנה. הנועץ/ת לא רואה אותו.'));
}

// Inside the popup: "טקסט" (default) | "סיכום לנועץ" | "תשובות הנועץ" | "העתקה"
function answerViews(q, client, start) {
  const text = el('div', {}, el('div', { class: 'answers' }, q.summary || '—'), q.id === 'la' ? ambCard(q.summary) : null);
  const canShow = !!(q.page && q.state && typeof CFL_HR_CLIENT_SITE === 'string');
  const panes = { text: text };
  const tabs = {};
  const copied = el('span', { class: 'copied', 'aria-live': 'polite' });

  function pick(key) {
    if (!panes[key]) { // the page views are built the first time they're opened
      panes[key] = el('div', { class: 'visual' }, key === 'matrix' ? matrixFrame(q, client)
        : clientFrame(q, client, key === 'answers' ? 'view-answers' : key === 'analysis' ? 'view-analysis' : 'view'));
      area.append(panes[key]);
    }
    Object.keys(panes).forEach(k => { panes[k].hidden = k !== key; });
    Object.keys(tabs).forEach(k => tabs[k].classList.toggle('on', k === key));
  }
  const tab = (key, label) => (tabs[key] = el('button', { type: 'button', class: 'seg' + (key === 'text' ? ' on' : ''), onclick: () => pick(key) }, label));

  const copyBtn = el('button', { type: 'button', class: 'seg copy', onclick: async () => {
    const ok = await copyText(q.summary || '');
    copied.textContent = ok ? 'הועתק' : 'ההעתקה לא הצליחה';
    setTimeout(() => { copied.textContent = ''; }, 2200);
  } }, 'העתקה');

  const area = el('div', { class: 'panes' }, text);
  const body = el('div', { class: 'qbody' },
    el('div', { class: 'toolbar' },
      el('div', { class: 'segs' }, tab('text', 'טקסט'),
        canShow ? tab('results', 'סיכום לנועץ') : null,
        canShow ? tab('answers', 'תשובות הנועץ') : null,
        canShow && q.id === 'intake' ? tab('analysis', 'ניתוח מלא') : null,
        q.id === 'matrix' && matrixState(q) ? tab('matrix', 'קריאת התוצאות') : null),
      el('div', {}, copied, copyBtn)),
    area);
  if (start && canShow) pick(start);
  return body;
}

// The questionnaire page from the נועצים site, read-only, fed with the saved answers from here.
// mode: 'view' = the summary screen, 'view-answers' = the questionnaire with the answers filled in
function clientFrame(q, client, mode) {
  const src = CFL_HR_CLIENT_SITE + q.page + '#' + mode;
  const origin = new URL(src, location.href).origin;
  const frame = el('iframe', { class: 'client-frame', title: q.title + ' – ' + (mode === 'view' ? 'סיכום לנועץ' : mode === 'view-analysis' ? 'ניתוח מלא' : 'תשובות הנועץ'), src: src, loading: 'lazy' });
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin || !e.data || e.data.type !== 'cfl-view-ready') return;
    frame.contentWindow.postMessage({ type: 'cfl-view', state: q.state, submittedAt: q.sentAt, updatedAt: q.updatedAt,
      name: client.name, gender: client.gender }, origin);
  };
  window.addEventListener('message', onMsg);
  // stop listening once the popup is closed
  const watch = setInterval(() => { if (!frame.isConnected) { clearInterval(watch); window.removeEventListener('message', onMsg); } }, 1000);
  return frame;
}

// מטריצת ההחלטה: Nurit's "קריאת התוצאות" screen (on this site only, for יועצים), fed with the saved answers
function matrixState(q) {
  try { const raw = q.state && q.state.ls && q.state.ls.cim_matrix_client_v1; const x = raw ? JSON.parse(raw) : null; return x && x.s ? x.s : null; }
  catch (e) { return null; }
}
function matrixFrame(q, client) {
  const frame = el('iframe', { class: 'client-frame', title: 'מטריצת ההחלטה – קריאת התוצאות', src: 'CFL_HR_matrix.html' });
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin || !e.data || e.data.type !== 'cfl-matrix-ready') return;
    frame.contentWindow.postMessage({ type: 'cfl-matrix', s: Object.assign({}, matrixState(q), { name: client.name || '' }) }, location.origin);
  };
  window.addEventListener('message', onMsg);
  const watch = setInterval(() => { if (!frame.isConnected) { clearInterval(watch); window.removeEventListener('message', onMsg); } }, 1000);
  return frame;
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { }
    ta.remove(); return ok;
  }
}

function backLink() {
  return el('div', { class: 'back' }, el('button', { type: 'button', class: 'link-btn', onclick: () => showClients() }, '→ חזרה לרשימת הנועצים'));
}

// ---------- staff ----------
async function showStaff() {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  loading('staff');
  const list = await api('staffList');
  if (seq !== viewSeq) return;
  if (!list.ok) { if (!list.handled) render(menu('staff'), msgBox(list.message)); return; }

  const tableBox = el('div');
  drawStaff(tableBox, list.staff);

  const addMsg = el('div');
  const email = el('input', { type: 'email', dir: 'ltr', required: true, placeholder: 'name@gmail.com' });
  const name = el('input', { type: 'text', required: true, maxlength: '60' });
  const addBtn = el('button', { type: 'submit', class: 'btn primary' }, 'הוספה');
  const openBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => { form.hidden = false; openBtn.hidden = true; email.focus(); } }, 'הוסף יועץ/ת');
  const form = el('form', {
    class: 'add-form', hidden: true,
    onsubmit: async (e) => {
      e.preventDefault();
      addMsg.replaceChildren();
      await withBusy(addBtn, async () => {
        const r = await api('staffAdd', { email: email.value, name: name.value });
        if (!r.ok) { if (!r.handled) addMsg.append(msgBox(r.message)); return; }
        drawStaff(tableBox, r.staff);
        addMsg.append(msgBox(name.value.trim() + ' נוסף/ה ליועצים. מעכשיו אפשר להיכנס עם חשבון ה-Google של ' + email.value.trim().toLowerCase() +
          (r.cvShared === false ? '. שימו לב: שיתוף תיקיית קורות החיים ב-Drive לא הצליח כרגע, ויתבצע שוב בבדיקה השעתית.' : ', ולצפות בקורות החיים ב-Drive.'), 'success'));
        email.value = ''; name.value = '';
        form.hidden = true;
        openBtn.hidden = false;
      });
    }
  },
    field('אימייל של חשבון Google', email),
    field('שם מלא', name),
    el('p', { class: 'hint' }, 'יש להזין את הכתובת בדיוק כמו בחשבון ה-Google של היועץ/ת.'),
    el('div', { class: 'row' }, addBtn,
      el('button', { type: 'button', class: 'btn secondary', onclick: () => { form.hidden = true; openBtn.hidden = false; } }, 'ביטול')));

  render(menu('staff'),
    el('h1', {}, 'יועצים'),
    el('p', { class: 'sub' }, 'מי יכול/ה להיכנס לממשק היועצים.'),
    el('div', { class: 'card' }, tableBox, addMsg, openBtn, form));
}

function drawStaff(box, staff) {
  const rows = staff.map(s => el('tr', {},
    el('td', {}, s.name || '—'),
    el('td', { dir: 'ltr', class: 'mail' }, s.email),
    el('td', {}, s.addedBy ? s.addedBy : 'הוזנ/ה ידנית'),
    el('td', {}, s.lastLogin || '—')));
  box.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'staff' },
    el('thead', {}, el('tr', {}, el('th', {}, 'שם'), el('th', {}, 'אימייל'), el('th', {}, 'נוסף/ה על ידי'), el('th', {}, 'כניסה אחרונה'))),
    el('tbody', {}, rows))));
}

// ---------- settings: my לשון, my Claude link, the instructions for Claude ----------
async function showSettings() {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  loading('settings');
  const [s, g] = await Promise.all([api('mySettings'), api('guideList')]);
  if (seq !== viewSeq) return;
  if (!s.ok || !g.ok) { const bad = !s.ok ? s : g; if (!bad.handled) render(menu('settings'), msgBox(bad.message)); return; }
  const msg = el('div');
  const gender = radios('s_gender', [['f', 'יועצת (נקבה)'], ['m', 'יועץ (זכר)']], s.settings.gender);
  const link = el('input', { type: 'url', id: 's_link', dir: 'ltr', value: s.settings.claudeUrl, placeholder: 'https://claude.ai/artifact/…' });
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'שמירה');
  const guideBox = el('div');
  drawGuides(guideBox, g);
  render(menu('settings'), el('h1', {}, 'הגדרות'),
    el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      await withBusy(btn, async () => {
        const res = await api('mySettings', { set: true, gender: gender.value(), claudeUrl: link.value });
        if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
        msg.append(msgBox('נשמר.', 'success'));
      });
    } },
      el('h2', {}, 'שלי'),
      el('div', { class: 'field' }, el('span', {}, 'בטקסטים ש-Claude כותב בשמי, אני כותב/ת בלשון'), gender.node),
      field('הקישור לדף Claude שלי', link),
      el('p', { class: 'hint' }, 'הכתובת של דף "חוזה עם החיים · Claude" בחשבון Claude שלך. פותחים את הדף ב-claude.ai ומעתיקים את הכתובת.'),
      msg, el('div', { class: 'row' }, btn)),
    guideBox);
}

function drawGuides(box, g) {
  const msg = el('div');
  const text = el('textarea', { id: 'g_text', rows: '2', placeholder: 'למשל: לכתוב בשפה פשוטה יותר, בלי מילים גבוהות' });
  const scope = radios('g_scope', [['shared', 'לכל היועצים'], ['me', 'רק לי']], 'shared');
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'הוספה');
  const item = (x) => el('div', { class: 'guide' }, el('span', {}, x.text), el('span', { class: 'muted small' }, ' · ' + x.byName + ' · ' + x.at),
    el('button', { type: 'button', class: 'link-btn small', onclick: async () => {
      const res = await api('guideDelete', { id: x.id });
      if (!res.ok) { if (!res.handled) msg.replaceChildren(msgBox(res.message)); return; }
      drawGuides(box, res);
    } }, 'מחיקה'));
  box.replaceChildren(el('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    if (!text.value.trim()) return;
    await withBusy(btn, async () => {
      const res = await api('guideAdd', { text: text.value, scope: scope.value() });
      if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
      drawGuides(box, res);
    });
  } },
    el('h2', {}, 'מה לימדנו את Claude'),
    el('p', { class: 'hint' }, 'הנחיות קבועות. Claude פועל לפיהן בכל ניתוח ובכל משוב. אפשר להוסיף גם מתוך דף Claude.'),
    el('h3', {}, 'לכל היועצים'), g.shared.length ? g.shared.map(item) : el('p', { class: 'muted small' }, 'אין עדיין.'),
    el('h3', {}, 'רק שלי'), g.mine.length ? g.mine.map(item) : el('p', { class: 'muted small' }, 'אין עדיין.'),
    el('h3', {}, 'הנחיה חדשה'), text, scope.node, msg, el('div', { class: 'row' }, btn)));
}

// ===================== Start =====================
if (CFL_HR_API_URL.indexOf('PASTE_') === 0) {
  render(msgBox('ממשק היועצים עדיין לא חובר לשרת: יש להדביק את כתובת ה-Web App בקובץ CFL_HR_config.js.'));
} else if (getToken()) {
  showHome();
} else {
  showLogin();
}
