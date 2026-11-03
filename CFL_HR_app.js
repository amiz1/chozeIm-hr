// חוזה עם החיים (CFL) – ממשק יועצים, צד הדפדפן
// The login is kept in localStorage until logout (or 30 days with no use, checked by the server).
const HR_TOKEN_KEY = 'cfl_hr_token';

const app = document.getElementById('app');
const navName = document.getElementById('navName');
const logoutBtn = document.getElementById('logoutBtn');
let me = null; // { name, email }

// signed in until logout: the key is kept in this browser (every tab, also after closing it)
function getToken() {
  try {
    const t = localStorage.getItem(HR_TOKEN_KEY);
    if (t) return t;
    const old = sessionStorage.getItem(HR_TOKEN_KEY); // a sign-in from before this version: keep it
    if (old) { localStorage.setItem(HR_TOKEN_KEY, old); sessionStorage.removeItem(HR_TOKEN_KEY); }
    return old;
  } catch (e) { return null; }
}
function setToken(v) {
  try { if (v === null) localStorage.removeItem(HR_TOKEN_KEY); else localStorage.setItem(HR_TOKEN_KEY, v); } catch (e) { }
  try { sessionStorage.removeItem(HR_TOKEN_KEY); } catch (e) { }
}
// logged out in another tab: this tab follows
window.addEventListener('storage', (e) => {
  if (e.key === HR_TOKEN_KEY && !e.newValue && me) { me = null; cacheClear(); showLogin(); }
});

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
    cacheClear(); setToken(null);
    showLogin(out.message);
    return { ok: false, handled: true };
  }
  if (out.me) { me = out.me; navName.textContent = me.name || me.email; logoutBtn.hidden = false; paintMenu(); }
  if (typeof out._ms === 'number') console.info('[שרת] ' + action + ': ' + out._ms + ' ms בשרת'); // to see where the time goes
  return out;
}

// ===================== Remembering answers (makes moving around fast) =====================
// Lists and נועץ pages are drawn at once from the last visit in this browser (kept until logout), then refreshed in the background.
const CACHE_PREFIX = 'cfl_hr_c_';
function cacheGet(key) {
  try {
    const o = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null');
    return o && o.token === getToken() ? o.r : null;
  } catch (e) { return null; }
}
// when the page's data was last pulled from the server (shown next to "רענן")
const fetchedAt = {};
function cacheAt(key) {
  if (fetchedAt[key]) return fetchedAt[key];
  try { const o = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null'); return o && o.at || 0; } catch (e) { return 0; }
}
function cachePut(key, r, at) {
  fetchedAt[key] = at || Date.now();
  const s = JSON.stringify({ token: getToken(), r: r, at: fetchedAt[key] });
  try { localStorage.setItem(CACHE_PREFIX + key, s); }
  catch (e) { // the tab's storage is full: forget the other תיקים (never the list), then try again
    try {
      Object.keys(localStorage).filter(k => k.indexOf(CACHE_PREFIX + 'client_') === 0 && k !== CACHE_PREFIX + key).forEach(k => localStorage.removeItem(k));
      localStorage.setItem(CACHE_PREFIX + key, s);
    } catch (x) { }
  }
}
// The list is never thrown away (it is redrawn from the server right after it is shown); a change we know of is applied to it at once
function listPatch(email, change) {
  const l = cacheGet('list');
  if (!l || !l.clients) return;
  const i = l.clients.findIndex(c => c.email === email);
  if (i === -1) return;
  if (change === null) l.clients.splice(i, 1); else Object.assign(l.clients[i], change);
  cachePut('list', l, cacheAt('list'));
}
function cacheDrop(key) { delete fetchedAt[key]; try { localStorage.removeItem(CACHE_PREFIX + key); } catch (e) { } }
function cacheClear() {
  try { Object.keys(localStorage).filter(k => k.indexOf(CACHE_PREFIX) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { }
  ahead = {};
  for (const k in fetchedAt) delete fetchedAt[k];
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
  return a && Date.now() - a.at < 30000 ? a : null;
}

// "רענן": pulls this page's data again from the server (only this page), with when it was last pulled
let pageKey = '', pageRefresh = null; // the page on screen, and how to pull it again
function whenText(at) {
  if (!at) return '';
  const d = new Date(at), p = n => String(n).padStart(2, '0');
  return 'עודכן ' + fmtWhen(d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()));
}
function refreshBar(key, again) {
  pageKey = key; pageRefresh = again;
  const at = cacheAt(key);
  return el('div', { class: 'refresh-bar' },
    el('span', { class: 'when muted small', title: at ? new Date(at).toLocaleString('he-IL') : '' }, whenText(at)),
    el('button', { type: 'button', class: 'btn secondary small refresh-btn', title: 'משיכת הנתונים של הדף הזה מחדש',
      onclick: (e) => { if (pageKey === key && pageRefresh) withBusy(e.currentTarget, pageRefresh); } }, 'רענן'));
}
// the data came back the same as on screen: just the time changes
function paintWhen(key) {
  if (pageKey !== key) return;
  const at = cacheAt(key);
  document.querySelectorAll('.refresh-bar .when').forEach(s => { s.textContent = whenText(at); s.title = at ? new Date(at).toLocaleString('he-IL') : ''; });
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
  me = { name: r.name, email: r.email, admin: !!r.admin };
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
  const staff = item('staff', 'יועצים', () => showStaff());
  staff.dataset.k = 'staff'; staff.hidden = !(me && me.admin); // the יועצים page: admins only
  return el('nav', { class: 'menu' }, item('clients', 'נועצים', () => showClients()), staff,
    item('settings', 'הגדרות', () => showSettings()));
}
function paintMenu() { document.querySelectorAll('.menu-item[data-k=staff]').forEach(b => { b.hidden = !(me && me.admin); }); }

function loading(active) { pageKey = ''; pageRefresh = null; render(menu(active), el('p', { class: 'loading' }, 'טוען…')); }

// "חזרה למסך הנועץ" in the Claude page links here with #prep=<request id> (no email in the address)
let prepLink = '';
function readPrepLink() {
  const m = /^#prep=(r[0-9a-f]{20})$/.exec(location.hash);
  if (!m) return false;
  prepLink = m[1];
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
  return true;
}
readPrepLink();
// the link opened while the site is already open in this tab
window.addEventListener('hashchange', () => { if (readPrepLink() && getToken()) showHome(); });
async function showHome() {
  if (prepLink) {
    const req = prepLink; prepLink = '';
    if (!(await ensureMe())) { prepLink = req; return; }
    loading('clients');
    const r = await api('prepFind', { req: req });
    if (r.ok) { meetSel[r.email] = r.n; cacheDrop('client_' + r.email); return showClient(r.email); }
    if (r.handled) { prepLink = req; return; }
    await showClients();
    app.prepend(msgBox(r.message));
    return;
  }
  await showClients();
}

// ---------- client list ----------
let clientSearch = '';
async function showClients() {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  const cached = cacheGet('list');
  if (cached) drawClients(cached); else loading('clients');
  await pullClients(seq, cached);
}
async function pullClients(seq, shown, keep) {
  const r = await api('clientList');
  if (seq !== viewSeq) return;
  if (!r.ok) { if (!r.handled && !shown) render(menu('clients'), msgBox(r.message)); else if (shown && !r.handled) app.prepend(msgBox(r.message)); return; }
  cachePut('list', r);
  if (!shown || !same(shown, r)) drawClients(r, !!shown || !!keep); else paintWhen('list');
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
  const group = select('nc_group', [['', 'לא נבחרה']].concat(openGroups(r.groups)), '');
  const qs = (r.qlist || []).map((q, i) => el('label', { class: 'check' },
    el('input', { type: 'checkbox', value: q.id, checked: i === 0 }), ' ' + q.title));
  const invite = el('input', { type: 'checkbox', id: 'nc_invite', checked: true });
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'פתיחת התיק');
  return el('form', { class: 'card new-case', onsubmit: async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    await withBusy(btn, async () => {
      const res = await api('caseOpen', { name: name.value, email: email.value, gender: g.value(), phone: phone.value, group: group.value,
        open: qs.map(l => l.querySelector('input')).filter(x => x.checked).map(x => x.value), invite: invite.checked });
      if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
      await showClient(res.email);
      if (res.invite === 'sent') app.querySelector('h1').after(msgBox('נשלח מייל הזמנה ל' + res.email + '.', 'success'));
      else if (res.invite === 'failed') app.querySelector('h1').after(msgBox('התיק נפתח, אבל מייל ההזמנה לא נשלח: ' + res.inviteError));
    });
  } },
    el('h2', {}, 'תיק חדש'),
    el('p', { class: 'hint' }, 'הכניסה לאתר הנועצים היא עם חשבון Google של האימייל הזה, ורק למי שנפתח לו תיק כאן. השאלונים שסימנת כבר יהיו פתוחים. מייל ההזמנה יוצא בשמך, ותשובות אליו מגיעות אליך.'),
    el('div', { class: 'grid2' }, field('שם מלא', name), field('אימייל', email), field('טלפון (לא חובה)', phone), field('קבוצה', group)),
    el('div', { class: 'field' }, el('span', {}, 'נועצת או נועץ'), g.node),
    qs.length ? el('div', { class: 'field' }, el('span', {}, 'שאלונים פתוחים מההתחלה'), el('div', { class: 'checks' }, qs)) : null,
    el('label', { class: 'check' }, invite, ' לשלוח לנועץ/ת מייל הזמנה (איך נרשמים, ומה כבר פתוח)'),
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

let onlyMine = false, clientSort = 'seen', showArchive = false;
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

function drawClients(r, refresh) {
  const hadFocus = refresh && document.activeElement && document.activeElement.classList.contains('search');
  const y = window.scrollY;
  const search = el('input', { type: 'search', class: 'search', placeholder: 'חיפוש לפי שם, אימייל, תגית או יועץ', value: clientSearch, 'aria-label': 'חיפוש נועץ' });
  const mine = el('input', { type: 'checkbox', id: 'onlyMine', checked: onlyMine });
  const nArch = r.clients.filter(c => c.archived).length;
  if (!nArch) showArchive = false; // nothing archived (any more): back to the normal list
  const arch = el('input', { type: 'checkbox', id: 'showArchive', checked: showArchive });
  const sort = select('clientSort', [['seen', 'מיון: כניסה אחרונה'], ['created', 'מיון: פתיחת התיק'], ['name', 'מיון: שם']], clientSort);
  sort.setAttribute('aria-label', 'מיון');
  const tableBox = el('div');
  const count = el('p', { class: 'muted small' });

  // "הצעד הבא (2)": the group's name in two words, its number and letter in parentheses
  // "לקראת פרישה (4א)": the short name, the code in parentheses
  const groupLabel = v => { const g = (r.groups || []).filter(x => x[0] === v)[0]; return g ? (g[2] || g[1]) + ' (' + groupCode(g[0]) + ')' : ''; };
  // three dots, always: filled · opened and waiting · not opened yet
  const dots = c => {
    const qs = c.qs || [], done = qs.filter(q => q.done), wait = qs.filter(q => !q.done), rest = c.notYet || [];
    const one = (cls, list, word) => el('span', { class: 'qd ' + cls, title: word + (list.length ? ':\n' + list.join('\n') : '') },
      el('span', { class: 'dot' }), el('span', { class: 'qn' }, String(list.length)));
    return el('span', { class: 'qdots', 'aria-label': done.length + ' מולאו, ' + wait.length + ' פתוחים וטרם מולאו, ' + rest.length + ' לא נפתחו' },
      one('done', done.map(q => q.title), 'מולאו'), one('wait', wait.map(q => q.title), 'פתוחים, טרם מולאו'), one('rest', rest, 'לא נפתחו'));
  };
  const nextText = c => !c.next ? 'טרם נקבע' : c.next.kind === 'proc' ? 'עיבוד ללא פגישה'
    : c.next.date ? fmtDay(c.next.date) + (c.next.time ? ' בשעה ' + c.next.time : '') : 'פגישה · טרם נקבע';

  function draw() {
    const q = search.value.trim().toLowerCase();
    clientSearch = search.value; onlyMine = mine.checked; clientSort = sort.value; showArchive = arch.checked;
    let list = r.clients.filter(c => (showArchive ? !!c.archived : !c.archived) && (!onlyMine || c.staff === r.myEmail) && (!q || (c.name || '').toLowerCase().includes(q) || c.email.includes(q) ||
      (c.staffName || '').toLowerCase().includes(q) || (c.tags || []).some(x => x.toLowerCase().includes(q))));
    const key = c => clientSort === 'seen' ? (c.lastSeen || '') : clientSort === 'created' ? (c.created || '') : '';
    list = list.slice().sort((a, b) => clientSort === 'name' ? (a.name || '').localeCompare(b.name || '', 'he') :
      key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0);
    const base = r.clients.filter(c => (showArchive ? !!c.archived : !c.archived) && (!onlyMine || c.staff === r.myEmail)).length;
    count.textContent = (list.length === base ? base : list.length + ' מתוך ' + base) + ' נועצים' + (onlyMine ? ' שלי' : '') + (showArchive ? ' בארכיון' : '') +
      (r.admin ? '' : ' · מוצגים הנועצים שלך ואלה שלא שויכו');
    if (!list.length) { tableBox.replaceChildren(el('p', { class: 'muted' }, showArchive ? 'אין נועצים בארכיון.' : r.clients.length ? 'אין תוצאות.' : 'עדיין אין נועצים רשומים.')); return; }
    const rows = list.map(c => el('tr', { class: 'clickable', tabindex: '0',
        onmouseenter: () => loadAhead(c.email), onfocus: () => loadAhead(c.email),
        onclick: () => showClient(c.email),
        onkeydown: (e) => { if (e.key === 'Enter') showClient(c.email); } },
        el('td', { class: 'who', title: c.email }, el('b', {}, c.name || c.email), c.age ? el('span', { class: 'muted' }, ' (' + c.age + ')') : null),
        el('td', { class: 'grp' }, groupLabel(c.group) || el('span', { class: 'muted' }, '—')),
        el('td', { class: 'staff-cell' }, c.staffName ? el('span', { class: c.staff === r.myEmail ? 'mine' : '' }, c.staff === r.myEmail ? 'אני' : c.staffName) : el('span', { class: 'muted' }, 'לא שויך')),
        el('td', { class: 'seen' }, c.registered === false ? el('span', { class: 'muted' }, 'טרם נכנס/ה') : c.lastSeen ? fmtWhen(c.lastSeen) : el('span', { class: 'muted' }, '—')),
        el('td', { class: 'qs-cell' }, dots(c)),
        el('td', { class: 'next-cell' + (c.next && c.next.date ? '' : ' muted'), title: c.next ? (c.next.kind === 'proc' ? 'עיבוד ללא פגישה ' : 'פגישה ') + c.next.n : '' }, nextText(c))));
    tableBox.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'staff clients' },
      el('thead', {}, el('tr', {}, el('th', {}, 'שם מלא (גיל)'), el('th', {}, 'קבוצה'), el('th', {}, 'יועץ/ת'), el('th', {}, 'כניסה אחרונה'),
        el('th', { class: 'qs-head' }, 'שאלונים'),
        el('th', {}, 'האינטראקציה הבאה'))),
      el('tbody', {}, rows))),
      el('p', { class: 'qlegend' }, 'שאלונים: ', el('span', { class: 'qd done' }, el('span', { class: 'dot' }), 'מולאו'),
        el('span', { class: 'qd wait' }, el('span', { class: 'dot' }), 'פתוחים, טרם מולאו'), el('span', { class: 'qd rest' }, el('span', { class: 'dot' }), 'לא נפתחו')));
  }
  search.addEventListener('input', draw); mine.addEventListener('change', draw); sort.addEventListener('change', draw); arch.addEventListener('change', draw);
  draw();

  render(menu('clients'),
    refreshBar('list', () => pullClients(viewSeq, cacheGet('list'), true)),
    el('div', { class: 'title-row' }, el('h1', {}, 'נועצים'), newCaseButton(r)),
    el('p', { class: 'sub' }, 'בחרו נועץ/ת כדי לפתוח את התיק.'),
    newCaseBox,
    el('div', { class: 'card' }, el('div', { class: 'list-tools' }, search, el('label', { class: 'check' }, mine, ' רק שלי'),
      nArch || showArchive ? el('label', { class: 'check' }, arch, ' ארכיון (' + nArch + ')') : null, sort), count, tableBox));
  if (refresh) { window.scrollTo(0, y); if (hadFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); } }
}

// ---------- one client ----------
async function showClient(email) {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  const key = 'client_' + email;
  const cached = cacheGet(key);
  if (cached) drawClient(cached); else { if (!previewClient(email)) loading('clients'); window.scrollTo(0, 0); }
  await pullClient(email, seq, cached, takeAhead(email));
}
async function pullClient(email, seq, shown, early, keep) {
  const key = 'client_' + email;
  const r = await (early ? early.promise : api('clientGet', { email: email }));
  if (seq !== viewSeq) return;
  if (!r.ok) {
    if (r.handled) return;
    if (!shown) render(menu('clients'), backLink(), msgBox(r.message)); else app.prepend(msgBox(r.message));
    return;
  }
  cachePut(key, r, early ? early.at : 0);
  if (!shown || !same(shown, r)) drawClient(r, !!shown || !!keep); else paintWhen(key);
  if (!cacheGet('list') && !listAhead) listAhead = api('clientList').then(l => { if (l && l.ok) cachePut('list', l); listAhead = null; });
}
let listAhead = null;
const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
// a תיק not seen yet in this tab: what the list already knows, at once, while the rest loads
function previewClient(email) {
  const list = cacheGet('list');
  const c = list && (list.clients || []).filter(x => x.email === email)[0];
  if (!c) return false;
  const g = (list.groups || []).filter(x => x[0] === c.group)[0];
  const facts = [GENDER_WORD[c.gender] || '', g ? (g[2] || g[1]) + ' (' + groupCode(g[0]) + ')' : '', c.age ? 'גיל ' + c.age : ''].concat(c.tags || []).filter(Boolean);
  const qs = c.qs || [], done = qs.filter(q => q.done).length, wait = qs.length - done;
  const next = !c.next ? 'טרם נקבעה' : (c.next.kind === 'proc' ? 'עיבוד ללא פגישה ' : 'פגישה ') + c.next.n +
    (c.next.date ? ' · ' + fmtDay(c.next.date) + (c.next.time ? ' בשעה ' + c.next.time : '') : '');
  pageKey = ''; pageRefresh = null;
  render(menu('clients'), el('div', { class: 'top-row' }, backLink()),
    el('div', { class: 'case-preview' },
      el('h1', {}, c.name || c.email),
      el('p', { class: 'sub case-facts' }, facts.join(' · ') || 'עוד אין פרטים'),
      el('p', { class: 'muted small case-contact' },
        c.staffName ? 'יועץ/ת מלווה: ' + (c.staff === list.myEmail ? 'אני' : c.staffName) + ' · ' : 'לא שויך/ה ליועץ/ת · ',
        el('span', { dir: 'ltr' }, c.email),
        c.registered === false ? ' · טרם נכנס/ה לאתר' : c.lastSeen ? ' · כניסה אחרונה ' + fmtWhen(c.lastSeen) : ''),
      el('div', { class: 'card preview-facts' },
        el('p', {}, el('b', {}, 'שאלונים: '), done + ' מולאו · ' + wait + ' פתוחים וטרם מולאו · ' + (c.notYet || []).length + ' לא נפתחו'),
        el('p', {}, el('b', {}, 'האינטראקציה הבאה: '), next))),
    el('p', { class: 'loading' }, 'טוען את שאר התיק…'));
  return true;
}

let currentClient = null; // the email of the תיק on screen (refreshed when you come back to this tab)
let qsOpen = false;


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

  // the bottom of the תיק: the timeline of interactions (פגישות and עיבודים), from the opening on
  const tabBox = el('div', { class: 'case-tab timeline-box' }, timelineSection(r));

  // text being written survives a refresh of the page (the note, and the meeting fields)
  const drafts = {};
  if (refresh) document.querySelectorAll('textarea[data-keep]').forEach(x => { if (x.value !== x.defaultValue) drafts[x.id] = { value: x.value, was: x.defaultValue }; });
  render(menu('clients'), el('div', { class: 'top-row' }, backLink(),
      refreshBar('client_' + c.email, () => pullClient(c.email, viewSeq, cacheGet('client_' + c.email), null, true))),
    el('h1', {}, c.name || c.email),
    el('p', { class: 'sub case-facts' }, facts.join(' · ') || 'עוד אין פרטים'),
    ci.archived ? el('div', { class: 'msg archived-note' }, 'התיק בארכיון מאז ' + ci.archived + '. הוא לא מופיע ברשימת הנועצים.',
      el('button', { type: 'button', class: 'btn secondary small', onclick: (e) => withBusy(e.currentTarget, () => saveCase(c.email, { archived: false })) }, 'החזרה מהארכיון')) : null,
    el('p', { class: 'muted small case-contact' }, ci.staff ? el('span', { class: 'case-staff' }, 'יועץ/ת מלווה: ' + (ci.staff === (me && me.email) ? 'אני' : (label(L.staff, ci.staff) || ci.staff)) + ' · ')
      : el('span', { class: 'case-staff' }, 'לא שויך/ה ליועץ/ת ', el('button', { type: 'button', class: 'btn secondary small assign-me',
        onclick: (e) => withBusy(e.currentTarget, () => saveCase(c.email, { staff: me.email })) }, 'שיוך אליי'), ' · '),
      el('span', { dir: 'ltr' }, c.email), ci.phone ? el('span', {}, ' · ', el('span', { dir: 'ltr' }, ci.phone)) : null,
      c.registered === false ? el('span', { class: 'badge wait not-reg' }, 'טרם נכנס/ה לאתר') : ' · בתיק מאז ' + (c.created || '—'),
      ci.consent ? ' · הסכמה לשמירת מידע ' + ci.consentAt : '',
      ci.privacyAt ? ' · אישר/ה את מדיניות הפרטיות ' + ci.privacyAt : (c.registered === false ? '' : ' · טרם אישר/ה את מדיניות הפרטיות')),
    caseDetails(r, L),
    !ci.group ? el('div', { class: 'card group-pick' }, el('b', {}, 'קבוצה: '), el('span', { class: 'muted' }, suggested ? 'הצעה לפי שאלון הכניסה: ' : 'עוד לא נבחרה. '),
      el('div', { class: 'row' }, openGroups(L.groups).map(([v, l]) => el('button', { type: 'button', class: 'btn small ' + (v === suggested ? 'primary' : 'secondary'),
        onclick: () => saveCase(c.email, { group: v }) }, l.split(' · ').slice(0, 2).join(' · '))))) : null,
    qsSection(el('summary', {}, 'השאלונים', el('span', { class: 'muted small' }, ' · ' + sentCount + ' מתוך ' + r.questionnaires.length + ' נשלחו' +
        (r.questionnaires.filter(q => q.open && !q.sentAt).length ? ' · ' + r.questionnaires.filter(q => q.open && !q.sentAt).length + ' פתוחים וממתינים' : ''))),
      openMailRow(r),
      blocks.length ? el('div', { class: 'qlist' }, blocks) : el('p', { class: 'muted' }, 'אין עדיין שאלונים במערכת.'),
      others.length ? el('details', { class: 'more-q' }, el('summary', {}, 'שאלונים נוספים, לקבוצות אחרות (' + others.length + ')'),
        el('div', { class: 'qlist' }, others.map(q => questionnaireRow(q, c)))) : null,
      cvRow(r.cv, c)),
    el('h2', { class: 'section-title tl-title' }, 'אינטראקציות'),
    tabBox,
    manageCase(r));
  Object.keys(drafts).forEach(id => {
    const x = document.getElementById(id);
    if (!x) return;
    if ((id === 'm_prep' || id === 'm_insight') && x.defaultValue !== drafts[id].was) return; // Claude wrote a new version: it wins
    x.value = drafts[id].value;
  });
  window.scrollTo(0, refresh ? y : 0);
}

function qsSection(summary, ...body) {
  const d = el('details', { class: 'case-qs', open: qsOpen }, summary, ...body);
  d.addEventListener('toggle', () => { qsOpen = d.open; });
  return d;
}

// the groups a תיק can be put in (the clinic, 2, is closed for now; a תיק already in it keeps showing it)
const openGroups = (list, keep) => (list || []).filter(g => g[0] !== '2' || g[0] === keep).map(g => [g[0], g[1]]);
const groupCode = c => String(c).replace('a', 'א').replace('b', 'ב');

// Group 1א… from the first answer of שאלון הכניסה (as the "תיקי נועצים" page did); the יועץ confirms it
function groupFromIntake(state) {
  const q1 = state && state.a ? state.a.q1 : null;
  if (q1 === null || q1 === undefined) return '';
  return q1 === 4 ? '4a' : q1 === 5 ? '4b' : q1 === 0 ? '' : '3';
}

const fmtDay = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? (+m[3]) + '.' + (+m[2]) + '.' + m[1] : String(d || ''); };
let currentReminders = {};

// ---------- interactions: a timeline of פגישות and עיבודים ללא פגישה, from the opening on ----------
// The opening (שאלון הכניסה and the CV) comes first; Claude's full analysis for the first פגישה is built on it.
// Each interaction: what came in for it, what Claude wrote (a prep for a פגישה, insights for an עיבוד), what was
// said and decided, and what comes next: questionnaires to open, tasks for the נועץ, and the kind of the next one.
const KIND = { meet: 'פגישה', proc: 'עיבוד ללא פגישה' };
let meetSel = {}, meetFlash = null; // the interaction open on screen per תיק; the message after a save

function timelineSection(r) {
  const c = r.client, ci = r.caseInfo || {}, E = r.entries || {};
  const ms = (ci.meetings || []).map(m => Object.assign({ kind: 'meet', done: false, date: '', time: '', given: [], tasks: [] }, m));
  const nextI = ms.findIndex(m => !m.done);
  let n = meetSel[c.email];
  if (n === undefined || n > ms.length) n = nextI === -1 ? ms.length : nextI + 1;
  const items = [openingItem(r, ms)];
  ms.forEach((m, i) => {
    const k = i + 1, T = (E.meetTexts || {})[k] || {};
    const line = ((T.summary || T.decisions || T.insight || {}).text || '').split('\n').filter(Boolean)[0] || '';
    const head = el('button', { type: 'button', class: 'tl-head', 'data-n': String(k), 'aria-expanded': k === n ? 'true' : 'false',
      onclick: () => { meetSel[c.email] = k === n ? 0 : k; meetFlash = null; drawClient(r, true); } },
      el('span', { class: 'tl-n' }, m.done ? '✓' : String(k)),
      el('span', { class: 'tl-kind' }, KIND[m.kind] + ' ' + k),
      el('span', { class: 'tl-when muted small' }, m.date ? fmtDay(m.date) + (m.time ? ' ' + m.time : '') : m.done ? '' : i === nextI ? 'הבאה · טרם נקבע' : ''),
      i === nextI ? el('span', { class: 'badge wait' }, 'הבאה') : null,
      !m.done || k === n ? null : el('span', { class: 'tl-line muted small' }, line.slice(0, 90)));
    items.push(el('div', { class: 'tl-item ' + m.kind + (m.done ? ' done' : '') + (i === nextI ? ' next' : '') + (k === n ? ' open' : '') },
      head, k === n ? interactionCard(r, ms, k) : null));
  });
  if (nextI === -1) items.push(el('div', { class: 'tl-item tl-add' }, el('span', { class: 'muted small' }, 'מה הלאה? '),
    ['meet', 'proc'].map(kind => el('button', { type: 'button', class: 'btn secondary small tl-add-' + kind, onclick: async (e) => {
      const res = await withBusy(e.currentTarget, () => api('meetSave', { email: c.email, n: ms.length + 1, kind: kind, given: [] }));
      if (!res.ok) { if (!res.handled) e.currentTarget.after(msgBox(res.message)); return; }
      meetSel[c.email] = ms.length + 1; afterMeetSave(r, res);
    } }, '+ ' + KIND[kind]))));
  const notes = E.notes || [];
  if (notes.length) items.push(el('details', { class: 'tl-old' }, el('summary', {}, 'רשמים מלפני האינטראקציות (' + notes.length + ')'),
    notes.map(x => el('div', { class: 'note' }, el('div', { class: 'note-head' }, el('b', {}, x.sub || 'הערה'), el('span', { class: 'muted small' }, ' ' + x.at + ' · ' + x.byName)),
      el('div', { class: 'note-text' }, x.text)))));
  return el('div', { class: 'timeline' }, items);
}

// the opening: שאלון הכניסה and the CV (what the first prep is built on)
function openingItem(r, ms) {
  const intake = r.questionnaires.filter(q => q.id === 'intake')[0];
  const first = ms[0] && !ms[0].done && ms[0].kind === 'meet';
  return el('div', { class: 'tl-item opening' + (intake && intake.sentAt ? ' done' : '') },
    el('div', { class: 'tl-head static' }, el('span', { class: 'tl-n' }, '0'), el('span', { class: 'tl-kind' }, 'פתיחה'),
      el('span', { class: 'tl-when muted small' }, 'שאלון הכניסה וקורות החיים')),
    el('ul', { class: 'mtg-qs opening-list' },
      intake ? el('li', { class: intake.sentAt ? 'done' : '' }, el('span', { class: 'dot' }), el('span', { class: 'qt' }, intake.title),
        intake.sentAt ? el('span', { class: 'muted small' }, ' · ' + fmtWhen(intake.sentAt)) : el('span', { class: 'badge wait' }, 'טרם מילא/ה'),
        intake.sentAt ? el('button', { type: 'button', class: 'link-btn small', onclick: () => openAnswers(intake, r.client) }, 'צפייה בתשובות') : null) : null,
      el('li', { class: r.cv ? 'done' : '' }, el('span', { class: 'dot' }), el('span', { class: 'qt' }, 'קורות חיים'),
        r.cv ? el('span', { class: 'muted small' }, ' · ' + r.cv.name + ' · ' + fmtWhen(r.cv.uploadedAt)) : el('span', { class: 'badge wait' }, 'לא הועלו'))),
    first ? el('p', { class: 'hint small' }, 'על בסיס אלה Claude כותב את ההכנה לפגישה הראשונה (בכרטיס של פגישה 1).') : null);
}

function afterMeetSave(r, res) {
  r.caseInfo = Object.assign({}, r.caseInfo, res.caseInfo); r.entries = res.entries;
  (res.opened || []).forEach(id => r.questionnaires.forEach(q => { if (q.id === id) q.open = true; }));
  cachePut('client_' + r.client.email, r);
  drawClient(r, true);
}

// what came in for interaction n: the questionnaires opened at the one before (for the first: all open or filled),
// and the tasks given there, with the files uploaded in answer
function inputsPart(r, ms, n) {
  const c = r.client, E = r.entries || {}, A = E.taskAnswers || {};
  const byId = {}; r.questionnaires.forEach(q => { byId[q.id] = q; });
  const prev = n > 1 ? ms[n - 2] : null;
  // only what this interaction is about: given at the end of the one before it (the first meeting: the intake),
  // and what was opened outside the interactions while it was the next one
  const ids = prev ? prev.given.slice() : ['intake'];
  (ms[n - 1].extra || []).forEach(id => { if (ids.indexOf(id) === -1) ids.push(id); });
  const qs = ids.map(id => byId[id]).filter(Boolean);
  const tasks = prev ? prev.tasks : [];
  const li = qs.map(q => el('li', { class: q.sentAt ? 'done' : '' },
    el('span', { class: 'dot' }), el('span', { class: 'qt' }, q.title),
    q.sentAt ? el('span', { class: 'muted small' }, ' · ' + fmtWhen(q.sentAt)) : el('span', { class: 'badge wait' }, q.open ? 'טרם מילא/ה' : 'סגור · טרם מילא/ה'),
    q.sentAt ? el('button', { type: 'button', class: 'link-btn small', onclick: () => openAnswers(q, c) }, 'צפייה בתשובות') : null))
    .concat(tasks.map(k => taskLine(k, A)));
  return el('div', { class: 'mtg-part' }, el('h4', {}, prev ? 'מה התקבל מאז ' + KIND[prev.kind] + ' ' + (n - 1) : 'מה מולא לקראת הפגישה'),
    li.length ? el('ul', { class: 'mtg-qs' }, li) : el('p', { class: 'muted small' }, prev ? 'לא נפתחו שאלונים ולא ניתנו משימות.' : 'עוד לא נפתחו שאלונים.'));
}
function taskLine(k, A) {
  const a = A[k.id];
  return el('li', { class: 'task-line' + (k.box ? (a ? ' done' : '') : ' plain') },
    el('span', { class: 'dot' }), el('span', { class: 'qt' }, 'משימה: ' + k.text),
    k.box ? (a ? el('span', { class: 'small' }, ' · ', a.url ? el('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.name) : a.name, el('span', { class: 'muted' }, ' · ' + fmtWhen(a.at)))
      : el('span', { class: 'badge wait' }, 'טרם הועלתה תשובה')) : null);
}

function interactionCard(r, ms, n) {
  const c = r.client, m = ms[n - 1], E = r.entries || {}, T = (E.meetTexts || {})[n] || {}, A = E.taskAnswers || {};
  const meet = m.kind === 'meet', first = !ms.slice(0, n - 1).some(x => x.done);
  const byId = {}; r.questionnaires.forEach(q => { byId[q.id] = q; });
  const msg = el('div', { class: 'mtg-msg', 'aria-live': 'polite' });
  const done = el('input', { type: 'checkbox', id: 'm_done', checked: m.done });
  const date = el('input', { type: 'date', id: 'm_date', value: m.date || '', 'aria-label': 'תאריך' });
  const time = el('input', { type: 'time', id: 'm_time', value: m.time || '', 'aria-label': 'שעה' });
  const kind = m.done ? null : select('m_kind', [['meet', KIND.meet], ['proc', KIND.proc]], m.kind);
  if (kind) kind.addEventListener('change', async () => {
    const res = await api('meetSave', { email: c.email, n: n, kind: kind.value });
    if (res.ok) afterMeetSave(r, res);
  });

  // what Claude writes: the prep of a פגישה (a fixed document, the first meeting too), or the insights of an עיבוד (optional)
  const field = meet ? 'prep' : 'insight';
  const cT = T[field] && T[field].text ? T[field] : null;
  const cMsg = el('div', { class: 'prep-msg', 'aria-live': 'polite' });
  const cName = meet ? 'הכנה לפגישה' : 'תובנות Claude (לא חובה)';
  // Claude writes straight into this box (in parts, so the text grows); a note under it makes Claude rewrite the same text
  const live = claudeRun && claudeRun.email === c.email && claudeRun.n === n && claudeRun.field === field ? claudeRun : null;
  const firstLabel = meet ? 'הכנה לפגישה עם Claude' : 'עיבוד עם Claude';
  const cBtn = el('button', { type: 'button', class: 'btn secondary prep-claude', disabled: !!live,
    onclick: (e) => claudeWrite(r, n, field, '', cMsg, e.currentTarget) }, cT ? 'כתיבה מחדש עם Claude' : firstLabel);
  const note = cT && !m.done ? el('textarea', { id: 'm_note', rows: '2', placeholder: 'מה לתקן, לקצר, להוסיף, או מה לא מדויק' }) : null;
  const noteBtn = note ? el('button', { type: 'button', class: 'btn secondary small prep-revise', disabled: !!live, onclick: () => {
    const v = note.value.trim(); if (!v) { cMsg.replaceChildren(msgBox('כתבו קודם מה לשנות.')); return; }
    claudeWrite(r, n, field, v, cMsg, noteBtn);
  } }, 'עדכון הטקסט לפי ההערה') : null;
  const stopBtn = live ? el('button', { type: 'button', class: 'link-btn small prep-stop', onclick: () => { if (claudeRun) claudeRun.stop = true; } }, 'עצירה') : null;
  // the prep is a document: shown as a page (not edited here; corrections go through the note), and downloadable as Word
  const wordBtn = meet && cT && !live ? el('button', { type: 'button', class: 'btn secondary small prep-word', onclick: (e) =>
    withBusy(e.currentTarget, () => downloadDocx(cT.text, (c.name || 'נועץ').trim() + ' – הכנה לפגישה ' + n + '.docx', cMsg)) }, 'הורדה כ-Word') : null;
  const textView = meet
    ? (live ? docView(live.text || '', 'claude-writing', 'm_' + field) : cT ? docView(cT.text, '', 'm_' + field) : null)
    : (live ? el('textarea', { id: 'm_' + field, rows: '12', readonly: true, class: 'claude-writing' }, live.text || '')
      : cT ? el('textarea', { id: 'm_' + field, 'data-keep': '1', rows: '12' }, cT.text) : null);
  const claudePart = el('div', { class: 'mtg-part prep' }, el('h4', {}, cName,
      cT && !live ? el('span', { class: 'muted small by' }, ' · ' + (cT.byName || '') + ', ' + fmtWhen(cT.at)) : null, wordBtn ? ' ' : null, wordBtn),
    live ? el('p', { class: 'claude-live small' }, el('span', { class: 'live-dot', 'aria-hidden': 'true' }),
      live.starting ? 'מכין את התיק בשביל Claude… ' : live.phase === 'review' ? 'הטיוטה נשמרה. Claude בודק אותה מול החומר… ' : live.rewrite ? 'Claude כותב מחדש לפי ההערה… ' : 'Claude כותב… ',
      live.phase === 'review' ? (live.rpart ? '(בדיקה, חלק ' + live.rpart + ')' : '') : live.part ? '(חלק ' + live.part + ')' : (meet ? 'זה לוקח כמה דקות.' : 'זה לוקח בערך דקה או שתיים.'), ' ', live.starting ? null : stopBtn) : null,
    textView,
    m.done ? null : cMsg,
    m.done ? el('p', { class: 'hint claude-closed' }, cT ? 'האינטראקציה התקיימה, ולכן Claude כבר לא כותב אליה. זו הגרסה האחרונה.' : 'לא נכתב טקסט עם Claude באינטראקציה הזו.')
      : cT || live ? null : el('p', { class: 'hint' }, meet
        ? 'Claude כותב הכנה לפגישה במבנה קבוע: תמונת מצב, השערת עבודה, מה עולה לפי נושאים, סתירות לבדוק, כוחות, נקודות לתשומת לב, מה מיטבי עד עכשיו, תוכנית לפגישה, הצעד הבא ומה עוד חסר. ההכנה נשמרת כאן, ואפשר להוריד אותה כ-Word.'
        : 'אם רוצים: Claude עובר על מה שהתקבל, ומציע אם לשלוח עוד הכנה לפני הפגישה. הטקסט נשמר כאן.'),
    note && !live ? el('label', { class: 'field claude-note' }, el('span', {}, 'הערה ל-Claude'), note) : null,
    m.done || live ? null : el('div', { class: 'row' }, noteBtn, cBtn));
  if (!live && claudeFlash && claudeFlash.email === c.email && claudeFlash.n === n) cMsg.append(claudeFlash.error ? msgBox(claudeFlash.text) : el('span', { class: 'saved-note' }, claudeFlash.text));

  const TEXTS = meet ? [['summary', 'סיכום הפגישה', 'מה עלה? מה הרגשת?'], ['decisions', 'החלטות', 'מה סוכם, ומה הכיוון להמשך'],
      ['gaps', 'פערים שראיתי', 'מה עלה בפגישה שלא תאם את מה שאמרו השאלונים (Claude בונה מזה "קומת פגישה" בהכנה הבאה)']]
    : [['decisions', 'מה הוחלט', 'מה עולה ממה שהתקבל, ומה עושים עכשיו']];
  const areas = TEXTS.map(([f, lab, ph]) => {
    const x = el('textarea', { id: 'm_' + f, 'data-keep': '1', rows: f === 'summary' ? '5' : '3', placeholder: ph }, (T[f] || {}).text || '');
    if (f === 'gaps') x.classList.add('gaps-box');
    return el('label', { class: 'field mtg-text' }, el('span', {}, lab,
      T[f] && T[f].text ? el('span', { class: 'muted small by' }, ' · ' + (T[f].byName || '') + ', ' + fmtWhen(T[f].at)) : null), x);
  });
  if (!m.done && !['summary', 'decisions'].some(f => T[f] && T[f].text)) areas.forEach(lab => lab.querySelector('textarea').addEventListener('input', (e) => {
    if (!e.target.value.trim()) return;
    if (meet) done.checked = true;
    if (meet && !date.value) { const d = new Date(), p2 = x => String(x).padStart(2, '0'); date.value = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  }));
  const oldTask = T.task && T.task.text ? el('p', { class: 'small muted old-task' }, 'משימה (מלפני האינטראקציות): ' + T.task.text) : null;

  // what comes next: questionnaires to open, tasks for the נועץ, and the kind of the next interaction
  const ci = r.caseInfo || {};
  const fits = q => !(q.groups && q.groups.length) || q.groups.indexOf(ci.group) !== -1 || m.given.indexOf(q.id) !== -1;
  const giveBox = q => el('label', { class: 'check' + (q.sentAt ? ' was-sent' : '') },
    el('input', { type: 'checkbox', value: q.id, checked: m.given.indexOf(q.id) !== -1 }), ' ' + q.title,
    q.sentAt ? el('span', { class: 'muted small' }, ' (כבר מולא)') : q.open && m.given.indexOf(q.id) === -1 ? el('span', { class: 'muted small' }, ' (פתוח)') : null);
  const otherQs = r.questionnaires.filter(q => q.id && !fits(q));
  const qPart = el('div', { class: 'give-qs' }, el('b', { class: 'small' }, 'שאלונים לפתוח לנועץ/ת'),
    el('div', { class: 'checks' }, r.questionnaires.filter(q => q.id && fits(q)).map(giveBox)),
    otherQs.length ? el('details', { class: 'more-give' }, el('summary', { class: 'small' }, 'שאלונים לקבוצות אחרות (' + otherQs.length + ')'),
      el('div', { class: 'checks' }, otherQs.map(giveBox))) : null);
  const taskRows = el('div', { class: 'tasks-edit' });
  const addTaskRow = k => {
    const text = el('input', { type: 'text', class: 'task-text', maxlength: '1500', value: k ? k.text : '', placeholder: 'למשל: לשוחח עם שני אנשים שעובדים בתחום' });
    const box = el('input', { type: 'checkbox', class: 'task-box', checked: !!(k && k.box) });
    const row = el('div', { class: 'task-row' }, text, el('label', { class: 'check small' }, box, ' תיבת מענה (הנועץ/ת מעלה קובץ Word)'),
      el('button', { type: 'button', class: 'link-btn small del', 'aria-label': 'מחיקת המשימה', onclick: () => row.remove() }, '✕'),
      k && k.box && A[k.id] ? el('div', { class: 'task-ans small' }, 'תשובה: ', A[k.id].url ? el('a', { href: A[k.id].url, target: '_blank', rel: 'noopener' }, A[k.id].name) : A[k.id].name, el('span', { class: 'muted' }, ' · ' + fmtWhen(A[k.id].at))) : null);
    row._get = () => ({ id: k ? k.id : undefined, text: text.value, box: box.checked });
    taskRows.append(row);
    return text;
  };
  m.tasks.forEach(k => addTaskRow(k));
  const taskPart = el('div', { class: 'give-tasks' }, el('b', { class: 'small' }, 'משימות לנועץ/ת עד האינטראקציה הבאה'),
    el('p', { class: 'hint small' }, 'הנועץ/ת רואה אותן בעמוד הראשי שלו/ה מרגע שהאינטראקציה סומנה שהתקיימה.'), taskRows,
    el('button', { type: 'button', class: 'link-btn small add-task', onclick: () => addTaskRow(null).focus() }, '+ משימה'));
  const following = ms[n];
  const nextKind = following && !following.done ? following.kind : 'meet';
  const nextBox = el('div', { class: 'next-kind radios', role: 'radiogroup' }, el('b', { class: 'small' }, 'האינטראקציה הבאה: '),
    ['meet', 'proc'].map(k => el('label', { class: 'check' }, el('input', { type: 'radio', name: 'm_next', value: k, checked: k === nextKind,
      disabled: !!(following && following.done) }), ' ' + KIND[k])));
  const nextPart = el('div', { class: 'mtg-part next-part' }, el('h4', {}, 'מה הלאה'), qPart, taskPart, nextBox);

  if (meetFlash && meetFlash.email === c.email && meetFlash.n === n) {
    msg.append(el('span', { class: 'saved-note' }, meetFlash.text));
    if (meetFlash.mail) {
      const mb = el('button', { type: 'button', class: 'btn secondary small', onclick: async () => {
        const res = await withBusy(mb, () => api('mailOpened', { email: c.email }));
        if (!res.ok) { if (!res.handled) msg.replaceChildren(msgBox(res.message || 'המייל לא נשלח')); return; }
        meetFlash = null; cacheDrop('client_' + c.email);
        msg.replaceChildren(el('span', { class: 'saved-note' }, 'נשלח מייל על: ' + res.sentAbout.join(', ')));
      } }, 'שליחת מייל לנועץ על השאלונים והמשימות');
      msg.append(' ', mb);
    }
  }

  const save = el('button', { type: 'button', class: 'btn primary', id: 'm_save', onclick: async () => {
    msg.replaceChildren();
    const texts = {}; TEXTS.forEach(([f]) => { texts[f] = document.getElementById('m_' + f).value; });
    if (!meet && document.getElementById('m_' + field)) texts[field] = document.getElementById('m_' + field).value;
    const given = [...qPart.querySelectorAll('input:checked')].map(x => x.value);
    const tasks = [...taskRows.children].map(x => x._get()).filter(x => x.text.trim());
    const nx = nextBox.querySelector('input:checked');
    const before = m.tasks.map(k => k.id).join();
    const res = await withBusy(save, () => api('meetSave', { email: c.email, n: n, done: done.checked, date: date.value, time: meet ? time.value : '',
      given: given, tasks: tasks, next: done.checked && nx ? nx.value : undefined, texts: texts }));
    if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
    const titles = (res.opened || []).map(id => (byId[id] || {}).title || id);
    const saved = (res.caseInfo.meetings || [])[n - 1] || {};
    const newTasks = done.checked && (saved.tasks || []).length && (saved.tasks || []).map(k => k.id).join() !== before;
    meetSel[c.email] = n; // stay on this interaction after the save
    meetFlash = { email: c.email, n: n, mail: !!(titles.length || newTasks || (done.checked && !m.done && (saved.tasks || []).length)),
      text: 'נשמר' + (titles.length ? '. נפתחו לנועץ/ת: ' + titles.join(', ') : '') + (res.added ? '. נוספה ' + KIND[(res.caseInfo.meetings[res.added - 1] || {}).kind] + ' ' + res.added : '') };
    TEXTS.concat(meet ? [] : [[field]]).forEach(([f]) => { const x = document.getElementById('m_' + f); if (x) x.defaultValue = x.value; });
    afterMeetSave(r, res);
  } }, 'שמירה');

  return el('div', { class: 'card mtg-card ' + m.kind + (m.done ? ' done' : '') },
    el('div', { class: 'mtg-head' }, el('h3', {}, KIND[m.kind] + ' ' + n),
      el('span', { class: 'mtg-when' }, kind, el('label', { class: 'check' }, done, meet ? ' התקיימה' : ' בוצע'),
        meet ? date : (m.date ? el('span', { class: 'small' }, fmtDay(m.date)) : null), meet ? time : null)),
    inputsPart(r, ms, n),
    claudePart,
    areas,
    oldTask,
    nextPart,
    el('div', { class: 'row' }, save, msg));
}

// The algorithmic analysis of שאלון הכניסה ("מפת שיחה ליועץ/ת"): the intake page builds it; the site loads that page
// out of sight (same address family, so its text can be read) and takes the text. '' when there is no intake or it fails.
async function readIntakeAnalysis(r) {
  const q = (r.questionnaires || []).filter(x => x.id === 'intake')[0];
  if (!q || !q.state || !q.page || typeof CFL_HR_CLIENT_SITE !== 'string') return '';
  const frame = clientFrame(q, r.client, 'view-analysis');
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:900px;visibility:hidden';
  frame.removeAttribute('loading');
  document.body.append(frame);
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise(ok => setTimeout(ok, 250));
      let d = null; try { d = frame.contentDocument; } catch (e) { return ''; }
      const app = d && (d.getElementById('app') || d.body);
      const txt = app ? String(app.innerText || app.textContent || '').trim() : '';
      if (txt.length > 300 && /מפת שיחה/.test(txt)) return txt.replace(/\n{3,}/g, '\n\n').slice(0, 20000);
    }
    return '';
  } finally { frame.remove(); }
}

// ---------- the prep document: the Markdown Claude writes, shown as a page and built into a Word file ----------
// Blocks: headings (#, ##, ###), tables (| … |), list items (- / • / 1.), and one paragraph per line; **bold** inside.
function mdBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n'), out = [];
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], s = l.trim();
    if (!s) continue;
    let m;
    if ((m = s.match(/^(#{1,3})\s+(.*)$/))) { out.push({ t: 'h' + m[1].length, text: m[2] }); continue; }
    if (s[0] === '|') {
      const rows = [];
      for (; i < lines.length && lines[i].trim()[0] === '|'; i++) {
        const c = cells(lines[i]);
        if (c.every(x => /^:?-{2,}:?$/.test(x) || x === '')) continue; // the separator row
        rows.push(c);
      }
      i--;
      const w = Math.max(...rows.map(r => r.length));
      if (rows.length) out.push({ t: 'table', rows: rows.map(r => r.concat(Array(w - r.length).fill(''))) });
      continue;
    }
    // a question for the נועץ ("- **מה לשאול:** …", or a numbered line that opens with a quote) shows in a box
    if ((m = s.match(/^[-•*]\s+(.*)$/))) { out.push({ t: 'li', text: m[1], q: /^\*\*מה לשאול:?\*\*/.test(m[1]) }); continue; }
    if ((m = s.match(/^(\d+)[.)]\s+(.*)$/))) { out.push({ t: 'li', n: m[1], text: m[2], q: /^["״“”]/.test(m[2]) }); continue; }
    out.push({ t: 'p', text: s });
  }
  return out;
}
/** "**a** b" -> [{ text: 'a', b: true }, { text: ' b' }] */
function mdRuns(s) {
  return String(s || '').split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(x => /^\*\*[^*]+\*\*$/.test(x) ? { text: x.slice(2, -2), b: true } : { text: x.replace(/\*\*/g, '') });
}
function docView(text, extra, id) {
  const inl = s => mdRuns(s).map(r => r.b ? el('b', {}, r.text) : r.text);
  const doc = el('div', { class: 'prep-doc' + (extra ? ' ' + extra : ''), id: id || null, dir: 'rtl' });
  let list = null, body = doc;
  mdBlocks(text).forEach(b => {
    if (b.t !== 'li') list = null;
    if (b.t === 'h2') body = doc; // the check's lines ("## בדיקת איכות") go in their own grey box
    if (b.t === 'h1') body.append(el('h3', { class: 'doc-title' }, inl(b.text)));
    else if (b.t === 'h2' && /^בדיקת איכות/.test(b.text)) { body = el('div', { class: 'doc-check' }, el('h4', { class: 'doc-h' }, inl(b.text))); doc.append(body); }
    else if (b.t === 'h2') body.append(el('h4', { class: 'doc-h' }, inl(b.text)));
    else if (b.t === 'h3') body.append(el('h5', { class: 'doc-h3' }, inl(b.text)));
    else if (b.t === 'p') body.append(el('p', {}, inl(b.text)));
    else if (b.t === 'li') {
      if (!list || list.dataset.ol !== (b.n ? '1' : '')) { list = el(b.n ? 'ol' : 'ul', { 'data-ol': b.n ? '1' : '' }); body.append(list); }
      list.append(el('li', b.q ? { class: 'doc-q' } : {}, inl(b.text)));
    } else if (b.t === 'table') {
      const head = b.rows[0], rest = b.rows.slice(1);
      body.append(el('div', { class: 'doc-table' }, el('table', {},
        el('thead', {}, el('tr', {}, head.map(c => el('th', {}, inl(c))))),
        el('tbody', {}, rest.map(r => el('tr', {}, r.map((c, i) => el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}, inl(c)))))))));
    }
  });
  return doc;
}
// the Word file is built here in the browser (docx, loaded the first time it's needed)
let docxLib = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  if (!docxLib) docxLib = new Promise((ok, bad) => {
    const s = el('script', { src: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js' });
    s.onload = () => window.docx ? ok(window.docx) : bad(new Error('docx'));
    s.onerror = () => { docxLib = null; bad(new Error('docx')); };
    document.head.append(s);
  });
  return docxLib;
}
async function downloadDocx(text, filename, msg) {
  let D;
  try { D = await loadDocx(); } catch (e) { if (msg) msg.replaceChildren(msgBox('לא הצלחתי לטעון את הכלי שבונה את קובץ ה-Word. בדקו את החיבור לאינטרנט ונסו שוב.')); return; }
  const OLIVE = '5E6A41';
  const runs = (s, o) => mdRuns(s).map(r => new D.TextRun({ text: r.text, bold: !!(r.b || (o && o.bold)), rightToLeft: true, font: 'Arial', size: (o && o.size) || 22, color: o && o.color }));
  const para = (s, o) => new D.Paragraph(Object.assign({ bidirectional: true, spacing: { after: 120, line: 300 }, children: runs(s, o) }, o && o.para));
  const children = [];
  let inCheck = false;
  mdBlocks(text).forEach(b => {
    if (b.t === 'h2') inCheck = /^בדיקת איכות/.test(b.text);
    if (b.t === 'h1') children.push(para(b.text, { bold: true, size: 32, para: { spacing: { after: 60 } } }));
    else if (b.t === 'h2') children.push(para(b.text, { bold: true, size: 26, color: OLIVE, para: { spacing: { before: 280, after: 120 } } }));
    else if (b.t === 'h3') children.push(para(b.text, { bold: true, size: 23 }));
    else if (b.t === 'p') children.push(para(b.text, inCheck ? { color: '6E6A5F', size: 20 } : undefined));
    else if (b.t === 'li') children.push(para((b.n ? b.n + '. ' : '• ') + b.text, { color: inCheck ? '6E6A5F' : undefined,
      para: Object.assign({ indent: { start: 360 } }, b.q ? { shading: { fill: 'F3EEDF', type: D.ShadingType.CLEAR, color: 'auto' }, border: { right: { style: D.BorderStyle.SINGLE, size: 12, color: 'B08A3E', space: 6 } } } : {}) }));
    else if (b.t === 'table') {
      const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'C9C5B9' };
      children.push(new D.Table({
        visuallyRightToLeft: true, width: { size: 100, type: D.WidthType.PERCENTAGE },
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: b.rows.map((r, ri) => new D.TableRow({ tableHeader: ri === 0, children: r.map((c, ci) => new D.TableCell({
          shading: ri === 0 ? { fill: 'EEF0E6', type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [para(c, { bold: ri === 0 || ci === 0, size: 20, para: { spacing: { after: 0, line: 260 } } })] })) }))
      }));
      children.push(para(''));
    }
  });
  const doc = new D.Document({ creator: 'חוזה עם החיים', title: filename.replace(/\.docx$/, ''),
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: children }] });
  const blob = await D.Packer.toBlob(doc);
  const a = el('a', { href: URL.createObjectURL(blob), download: filename.replace(/[\\/:*?"<>|]/g, '_') });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// ---------- Claude, through the server (the key is there): the text is written in parts, each under a minute ----------
let claudeRun = null;   // { email, n, field, text, part, rewrite, stop }: the text being written now
let claudeFlash = null; // { email, n, text, error }: after it finished (or stopped)
async function claudeWrite(r, n, field, comment, msg, btn) {
  const c = r.client;
  if (claudeRun) { msg.replaceChildren(msgBox('Claude כבר כותב טקסט אחר. רגע…')); return; }
  // the press answers at once, right here, before anything else is drawn or asked of the server
  if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Claude מתחיל…'; }
  msg.replaceChildren(el('p', { class: 'claude-live small' }, el('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'מכין את התיק בשביל Claude…'));
  claudeFlash = null;
  // what was typed in the other boxes stays (they are kept through the redraws)
  const redraw = () => { if (currentClient === c.email && app.querySelector('.case-tab')) { meetSel[c.email] = n; drawClient(r, true); } };
  // the card shows at once that Claude is starting (preparing the תיק can take a few seconds), and a problem stays
  // on screen even if the page was redrawn meanwhile
  claudeRun = { email: c.email, n: n, field: field, text: '', part: 0, rewrite: !!comment, stop: false, starting: true };
  redraw();
  // the algorithmic analysis of שאלון הכניסה is built by its page: read it from there, so Claude gets what the יועצת gets
  const intakeAnalysis = field === 'prep' ? await readIntakeAnalysis(r) : '';
  const start = await api('claudeStart', { email: c.email, n: n, comment: comment, intakeAnalysis: intakeAnalysis });
  if (!start.ok) {
    claudeRun = null;
    if (!start.handled) claudeFlash = { email: c.email, n: n, text: start.message || 'Claude לא הצליח להתחיל. אפשר לנסות שוב.', error: true };
    redraw();
    if (!start.handled && !document.querySelector('.prep-msg .msg')) msg.replaceChildren(msgBox(start.message || 'Claude לא הצליח להתחיל.'));
    return;
  }
  claudeRun.starting = false;
  redraw();
  let res = null;
  for (let tries = 0; ; ) {
    if (claudeRun.stop) { claudeFlash = { email: c.email, n: n, text: claudeRun.phase === 'review' ? 'הבדיקה נעצרה. הטיוטה נשמרה.' : 'נעצר. מה שנכתב עד העצירה לא נשמר; הטקסט הקודם נשאר.', error: claudeRun.phase !== 'review' }; break; }
    res = await api('claudeStep', { job: start.job });
    if (!res.ok) {
      if (res.handled) { claudeRun = null; return; }
      if (/עוד נכתב/.test(res.message || '') && tries++ < 20) { await new Promise(x => setTimeout(x, 3000)); continue; }
      claudeFlash = { email: c.email, n: n, text: res.message || 'Claude לא הצליח לכתוב. אפשר לנסות שוב.', error: true }; break;
    }
    claudeRun.text = res.text; claudeRun.part = res.part || claudeRun.part + 1;
    if (res.phase === 'review' && claudeRun.phase !== 'review') {
      claudeRun.phase = 'review'; if (res.entries) r.entries = res.entries; cachePut('client_' + c.email, r); redraw();
    }
    if (res.rpart) { claudeRun.rpart = res.rpart; const p = document.querySelector('.claude-live'); if (p && p.childNodes[2]) p.childNodes[2].textContent = '(בדיקה, חלק ' + res.rpart + ')'; }
    const box = document.getElementById('m_' + field);
    if (box && currentClient === c.email && meetSel[c.email] === n && claudeRun.phase !== 'review') { if (box.tagName === 'TEXTAREA') { box.value = res.text; box.scrollTop = box.scrollHeight; } else box.replaceWith(docView(res.text, 'claude-writing', box.id)); const p = document.querySelector('.claude-live'); if (p && p.childNodes[2]) p.childNodes[2].textContent = '(חלק ' + claudeRun.part + ')'; }
    if (res.done) break;
  }
  if (res && res.ok && res.done) {
    if (res.entries) r.entries = res.entries;
    cachePut('client_' + c.email, r);
    claudeFlash = { email: c.email, n: n, text: (comment ? 'הטקסט עודכן לפי ההערה ונשמר.' : 'נשמר.') +
      (res.reviewed === 'applied' ? ' עבר בדיקה מול החומר.' : res.note ? ' ' + res.note : '') };
  }
  claudeRun = null;
  const box = document.getElementById('m_' + field);
  if (box && box.tagName === 'TEXTAREA') box.defaultValue = box.value;
  redraw();
}

// ---------- managing the תיק: archive, and (admins) deleting everything ----------
function manageCase(r) {
  const c = r.client, ci = r.caseInfo || {};
  const arch = el('button', { type: 'button', class: 'btn secondary small', id: 'archiveBtn', onclick: (e) => withBusy(e.currentTarget, async () => {
    const ok = await saveCase(c.email, { archived: !ci.archived });
    if (ok && !ci.archived) { listPatch(c.email, { archived: today() }); showClients(); }
  }) }, ci.archived ? 'החזרה מהארכיון' : 'העברה לארכיון');
  return el('details', { class: 'case-manage' }, el('summary', {}, 'ניהול התיק'),
    el('div', { class: 'card' },
      el('div', { class: 'manage-row' }, el('div', {}, el('b', {}, 'ארכיון'),
        el('p', { class: 'hint' }, 'התיק יוסתר מרשימת הנועצים, וכל המידע נשמר. אפשר להחזיר אותו בכל עת (בסימון "ארכיון" ברשימה). לנועץ/ת לא משתנה דבר.')), arch),
      me && me.admin ? el('div', { class: 'manage-row danger' }, el('div', {}, el('b', {}, 'מחיקה מלאה'),
        el('p', { class: 'hint' }, 'מחיקת כל המידע על הנועץ/ת, לפי בקשה (חוק הגנת הפרטיות). אי אפשר לבטל. למנהלים בלבד, ודורש כניסה מחדש עם Google.')),
        el('button', { type: 'button', class: 'btn danger small', id: 'deleteBtn', onclick: () => deleteDialog(r) }, 'מחיקה מלאה…')) : null));
}

function deleteDialog(r) {
  const c = r.client, name = (c.name || c.email).trim().replace(/\s+/g, ' ');
  const dlg = el('dialog', { class: 'qmodal del-modal', 'aria-label': 'מחיקה מלאה' });
  const msg = el('div', { 'aria-live': 'polite' });
  const gbox = el('div', { class: 'gbtn' });
  const typed = el('input', { type: 'text', id: 'delConfirm', autocomplete: 'off', 'aria-label': 'השם המלא' });
  const step2 = el('div', { class: 'del-step2', hidden: true }, el('p', {}, el('b', {}, 'שלב אחרון: '), 'כניסה מחדש עם חשבון ה-Google שלך (' + me.email + '). המחיקה מתבצעת מיד אחרי האימות.'), gbox);
  const close = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  typed.addEventListener('input', () => {
    const okName = typed.value.trim().replace(/\s+/g, ' ') === name;
    step2.hidden = !okName;
    if (okName && !gbox.firstChild) drawReauth();
  });
  function drawReauth() {
    if (!window.google || !google.accounts || !google.accounts.id) { gbox.append(msgBox('הכניסה של Google לא נטענה. רעננו את הדף ונסו שוב.')); return; }
    google.accounts.id.initialize({ client_id: CFL_HR_CLIENT_ID, callback: onReauth, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
    google.accounts.id.renderButton(gbox, { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'rectangular', locale: 'he', width: 280 });
  }
  async function onReauth(resp) {
    msg.replaceChildren(el('p', { class: 'muted' }, 'מוחקים…'));
    gbox.replaceChildren(); typed.disabled = true;
    const res = await api('clientDelete', { email: c.email, idToken: resp && resp.credential, confirm: typed.value });
    if (!res.ok) {
      if (!res.handled) msg.replaceChildren(msgBox(res.message || 'המחיקה לא בוצעה.'));
      typed.disabled = false; drawReauth(); return;
    }
    cacheDrop('client_' + c.email); delete ahead[c.email]; listPatch(c.email, null);
    dlg.replaceChildren(el('div', { class: 'del-body' }, el('h2', {}, 'המידע נמחק'),
      el('p', {}, 'כל המידע על ' + name + ' נמחק מהמערכת. נשמרו רק השם, תאריך ההרשמה ותאריך המחיקה (בלשונית "מחיקות").'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 'delDone', onclick: () => { close(); showClients(); } }, 'חזרה לרשימת הנועצים'))));
  }
  dlg.append(
    el('div', { class: 'mhead' }, el('div', {}, el('div', { class: 'mtitle' }, 'מחיקה מלאה: ' + name), el('div', { class: 'msub', dir: 'ltr' }, c.email)),
      el('button', { type: 'button', class: 'mclose', 'aria-label': 'סגירה', onclick: close }, '✕')),
    el('div', { class: 'del-body' },
      el('p', {}, 'יימחקו לצמיתות:'),
      el('ul', {}, ['הפרטים וההרשמה לאתר הנועצים (הנועץ/ת לא יוכל/תוכל להיכנס עוד)', 'כל התשובות לשאלונים', 'קורות החיים, כולל הקובץ ב-Drive',
        'התיק: פרטים, רשמים, פגישות, שיחות עם Claude ומשובים', 'מה שנשלח לדף של Claude ועוד לא נקלט'].map(x => el('li', {}, x))),
      el('p', { class: 'muted small' }, 'נשמרים רק: השם, תאריך ההרשמה ותאריך המחיקה. מיילים שכבר נשלחו לנועץ/ת, ושיחות שנשמרו בחשבון Claude של היועץ/ת, לא נמחקים מכאן.'),
      el('p', { class: 'del-warn' }, 'אי אפשר לבטל את המחיקה.'),
      field('להמשך, הקלידו את השם המלא: ' + name, typed),
      step2, msg));
  document.body.append(dlg);
  dlg.showModal();
  typed.focus();
  return dlg;
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
  cacheDrop('client_' + email);
  if ('archived' in fields) listPatch(email, { archived: fields.archived ? today() : '' });
  if ('staff' in fields) listPatch(email, fields.staff === (me && me.email) ? { staff: fields.staff, staffName: me.name } : { staff: fields.staff });
  if ('group' in fields) listPatch(email, { group: fields.group });
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
    group: select('c_group', [['', 'לא נבחרה']].concat(openGroups(L.groups, ci.group)), ci.group || ''),
    note: el('textarea', { id: 'c_note', rows: '3' }, ci.note || ''),
    consent: el('input', { type: 'checkbox', id: 'c_consent', checked: !!ci.consent }),
    staff: !(me && me.admin) ? null : select('c_staff', [['', 'לא נבחר/ה']].concat(ci.staff && !(L.staff || []).some(s => s[0] === ci.staff) ? [[ci.staff, ci.staff]] : []).concat(L.staff || []), ci.staff || '')
  };
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'שמירת הפרטים');
  return el('details', { class: 'case-edit' }, el('summary', {}, 'עריכת פרטים'),
    el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      await withBusy(btn, () => saveCase(c.email, { name: f.name.value, gender: f.gender.value, phone: f.phone.value, fac: f.fac.value,
        tags: f.tags.value, age: f.age.value, years: f.years.value, kind: f.kind.value, group: f.group.value, note: f.note.value,
        consent: f.consent.checked, staff: f.staff ? f.staff.value : undefined }, msg));
    } },
      el('div', { class: 'grid2' }, field('שם', f.name), f.staff ? field('יועץ/ת מלווה', f.staff) : null, field('נועצת או נועץ', f.gender), field('טלפון', f.phone), field('מי זה/זו', f.kind),
        field('קבוצה', f.group), field('תחום / פקולטה', f.fac), field('תגיות (מפרידים בפסיק)', f.tags),
        el('div', { class: 'grid2' }, field('גיל', f.age), field('שנות ניסיון', f.years))),
      field('הערה כללית', f.note),
      el('label', { class: 'check consent' }, f.consent, ' הנועץ/ת הסכים/ה שהמידע יישמר בתיק' + (ci.consentAt ? ' (' + ci.consentAt + ')' : '')),
      msg, el('div', { class: 'row' }, btn)));
}

// (Until 31.10, coming back to this tab from the Claude page redrew the תיק. Claude now works inside the site, so
// switching windows changes nothing on screen: what you are typing and where you are stay as they were.
// "רענן" at the top pulls the newest data when you want it.)

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
    } else {
      if (q.open) {
        parts.push(el('span', { class: 'badge wait' }, 'טרם מילא/ה'));
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
  return 'מולא ' + q.sentAt + (q.updatedAt && q.updatedAt !== q.sentAt ? ' · עודכן ' + q.updatedAt : '');
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
  const text = el('div', {}, el('div', { class: 'answers' }, q.summary || '—'), q.id === 'la' ? ambCard(q.summary) : null,
    q.response ? el('div', { class: 'resp-box' }, el('h4', {}, 'השיקוף האישי שהנועץ/ת קיבל/ה' + (q.responseAt ? ' · ' + q.responseAt : '')), el('div', { class: 'answers' }, q.response)) : null);
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
      name: client.name, gender: client.gender, response: q.response || '', responseAt: q.responseAt || '' }, origin);
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
  fetchedAt.staff = Date.now();

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
    refreshBar('staff', async () => {
      const r = await api('staffList');
      if (pageKey !== 'staff') return;
      if (!r.ok) { if (!r.handled) addMsg.replaceChildren(msgBox(r.message)); return; }
      fetchedAt.staff = Date.now(); drawStaff(tableBox, r.staff); paintWhen('staff');
    }),
    el('h1', {}, 'יועצים'),
    el('p', { class: 'sub' }, 'מי יכול/ה להיכנס לממשק היועצים.'),
    el('div', { class: 'card' }, tableBox, addMsg, openBtn, form));
}

function drawStaff(box, staff) {
  const note = el('p', { class: 'saved-note', 'aria-live': 'polite' });
  const rows = staff.map(s => {
    const mine = me && s.email === me.email;
    const cb = el('input', { type: 'checkbox', class: 'admin-cb', checked: s.admin, disabled: s.owner || mine,
      'aria-label': 'מנהל/ת – ' + (s.name || s.email), title: s.owner ? 'בעל/ת המערכת: תמיד מנהל/ת' : mine ? 'אי אפשר לשנות את עצמך' : '' });
    cb.addEventListener('change', async () => {
      cb.disabled = true;
      const r = await api('staffSetAdmin', { email: s.email, admin: cb.checked });
      if (!r.ok) { cb.checked = !cb.checked; cb.disabled = false; if (!r.handled) note.textContent = r.message; return; }
      drawStaff(box, r.staff);
    });
    return el('tr', {},
      el('td', {}, s.name || '—'),
      el('td', { dir: 'ltr', class: 'mail' }, s.email),
      el('td', {}, el('label', { class: 'check' }, cb, s.owner ? ' בעלים' : '')),
      el('td', {}, s.addedBy ? s.addedBy : 'הוזנ/ה ידנית'),
      el('td', {}, s.lastLogin || '—'),
      el('td', {}, s.owner || mine ? null : el('button', { type: 'button', class: 'link-btn small del staff-remove', onclick: async (e) => {
        const b = e.currentTarget;
        if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'להסיר את ' + (s.name || s.email) + '? לחיצה נוספת'; return; }
        b.disabled = true;
        const r = await api('staffRemove', { email: s.email });
        if (!r.ok) { b.disabled = false; if (!r.handled) note.textContent = r.message; return; }
        drawStaff(box, r.staff);
        box.append(msgBox((s.name || s.email) + ' הוסר/ה. ' + (r.freed ? r.freed + ' נועצים שלו/ה עכשיו לא משויכים. ' : '') +
          'הגישה לקורות החיים ולתיבת Claude ' + (r.accessUpdated ? 'הוסרה.' : 'תוסר בבדיקה השעתית.'), 'success'));
      } }, 'הסרה')));
  });
  box.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'staff' },
    el('thead', {}, el('tr', {}, el('th', {}, 'שם'), el('th', {}, 'אימייל'), el('th', {}, 'מנהל/ת'), el('th', {}, 'נוסף/ה על ידי'), el('th', {}, 'כניסה אחרונה'), el('th', {}, ''))),
    el('tbody', {}, rows))),
    el('p', { class: 'hint' }, 'מנהל/ת רואה את כל הנועצים ואת דף היועצים, ויכול/ה למחוק נועץ/ת. יועץ/ת אחר/ת רואה רק את הנועצים שלו/ה ואת אלה שלא שויכו.'), note);
}

// ---------- settings: my לשון, my Claude link, the instructions for Claude ----------
async function showSettings() {
  if (!(await ensureMe())) return;
  const seq = ++viewSeq;
  loading('settings');
  const s = await api('mySettings');
  if (seq !== viewSeq) return;
  if (!s.ok) { if (!s.handled) render(menu('settings'), msgBox(s.message)); return; }
  const msg = el('div');
  const gender = radios('s_gender', [['f', 'יועצת (נקבה)'], ['m', 'יועץ (זכר)']], s.settings.gender);
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'שמירה');
  render(menu('settings'), el('h1', {}, 'הגדרות'),
    el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      await withBusy(btn, async () => {
        const res = await api('mySettings', { set: true, gender: gender.value() });
        if (!res.ok) { if (!res.handled) msg.append(msgBox(res.message)); return; }
        msg.append(msgBox('נשמר.', 'success'));
      });
    } },
      el('h2', {}, 'שלי'),
      el('div', { class: 'field' }, el('span', {}, 'בטקסטים ש-Claude כותב בשמי, אני כותב/ת בלשון'), gender.node),
      msg, el('div', { class: 'row' }, btn)),
    el('p', { class: 'hint small' }, 'מה Claude יודע ואיך הוא כותב נקבע במאגר ההנחיות של נורית (chozeIm-prompts), לכל הצוות.'));
}

// ===================== Start =====================
if (CFL_HR_API_URL.indexOf('PASTE_') === 0) {
  render(msgBox('ממשק היועצים עדיין לא חובר לשרת: יש להדביק את כתובת ה-Web App בקובץ CFL_HR_config.js.'));
} else if (getToken()) {
  showHome();
} else {
  showLogin();
}
