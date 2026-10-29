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
  return out;
}

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
  await api('hrLogout');
  setToken(null);
  try { google.accounts.id.disableAutoSelect(); } catch (e) { }
  showLogin();
}
logoutBtn.addEventListener('click', logout);

// ===================== Signed-in screens: menu, clients, one client, staff =====================
async function ensureMe() {
  if (!me) {
    const r = await api('hrMe');
    if (!r.ok) { if (!r.handled) showLogin(r.message); return false; }
    me = { name: r.name, email: r.email };
  }
  navName.textContent = me.name || me.email;
  logoutBtn.hidden = false;
  return true;
}

function menu(active) {
  const item = (key, label, go) => el('button', {
    type: 'button', class: 'menu-item' + (active === key ? ' on' : ''), 'aria-current': active === key ? 'page' : null, onclick: go
  }, label);
  return el('nav', { class: 'menu' }, item('clients', 'נועצים', () => showClients()), item('staff', 'יועצים', () => showStaff()));
}

function loading(active) { render(menu(active), el('p', { class: 'loading' }, 'טוען…')); }

async function showHome() { await showClients(); }

// ---------- client list ----------
let clientSearch = '';
async function showClients() {
  if (!(await ensureMe())) return;
  loading('clients');
  const r = await api('clientList');
  if (!r.ok) { if (!r.handled) render(menu('clients'), msgBox(r.message)); return; }

  const total = r.questionnaires.length;
  const search = el('input', { type: 'search', class: 'search', placeholder: 'חיפוש לפי שם או אימייל', value: clientSearch, 'aria-label': 'חיפוש נועץ' });
  const tableBox = el('div');
  const count = el('p', { class: 'muted small' });

  function draw() {
    const q = search.value.trim().toLowerCase();
    clientSearch = search.value;
    const list = r.clients.filter(c => !q || c.name.toLowerCase().includes(q) || c.email.includes(q));
    count.textContent = list.length === r.clients.length ? r.clients.length + ' נועצים' : list.length + ' מתוך ' + r.clients.length + ' נועצים';
    if (!list.length) { tableBox.replaceChildren(el('p', { class: 'muted' }, r.clients.length ? 'אין תוצאות לחיפוש הזה.' : 'עדיין אין נועצים רשומים.')); return; }
    const rows = list.map(c => el('tr', { class: 'clickable', tabindex: '0',
      onclick: () => showClient(c.email),
      onkeydown: (e) => { if (e.key === 'Enter') showClient(c.email); } },
      el('td', {}, el('b', {}, c.name || '—')),
      el('td', { dir: 'ltr', class: 'mail' }, c.email),
      el('td', {}, c.created || '—'),
      el('td', {}, el('span', { class: 'count' + (c.sent.length ? ' some' : '') }, c.sent.length + ' / ' + total),
        c.sent.length ? el('span', { class: 'sent-list' }, ' ' + c.sent.map(s => s.title).join(' · ')) : null)));
    tableBox.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'staff clients' },
      el('thead', {}, el('tr', {}, el('th', {}, 'שם'), el('th', {}, 'אימייל'), el('th', {}, 'נרשם/ה'), el('th', {}, 'שאלונים שנשלחו'))),
      el('tbody', {}, rows))));
  }
  search.addEventListener('input', draw);
  draw();

  render(menu('clients'),
    el('h1', {}, 'נועצים'),
    el('p', { class: 'sub' }, 'בחרו נועץ/ת כדי לראות את התשובות לשאלונים.'),
    el('div', { class: 'card' }, search, count, tableBox));
}

// ---------- one client ----------
async function showClient(email) {
  if (!(await ensureMe())) return;
  loading('clients');
  const r = await api('clientGet', { email: email });
  if (!r.ok) { if (!r.handled) render(menu('clients'), backLink(), msgBox(r.message)); return; }
  const c = r.client;
  const sentCount = r.questionnaires.filter(q => q.sentAt).length;

  const blocks = r.questionnaires.map(q => {
    if (!q.sentAt) {
      return el('div', { class: 'qblock pending' },
        el('div', { class: 'qhead' }, el('span', { class: 'qtitle' }, q.title), el('span', { class: 'badge wait' }, 'טרם נשלח')));
    }
    return el('details', { class: 'qblock' },
      el('summary', { class: 'qhead' }, el('span', { class: 'qtitle' }, q.title),
        el('span', { class: 'badge sent' }, 'נשלח ' + q.sentAt + (q.updatedAt && q.updatedAt !== q.sentAt ? ' · עודכן ' + q.updatedAt : ''))),
      answerViews(q, c));
  });

  const genderWord = c.gender === 'f' ? 'נקבה' : c.gender === 'm' ? 'זכר' : 'לא נבחרה';
  render(menu('clients'), backLink(),
    el('h1', {}, c.name || c.email),
    el('p', { class: 'sub' }, el('span', { dir: 'ltr' }, c.email), ' · נרשם/ה ' + (c.created || '—') + ' · לשון פניה: ' + genderWord + ' · ' + sentCount + ' מתוך ' + r.questionnaires.length + ' שאלונים נשלחו'),
    blocks.length ? el('div', { class: 'qlist' }, blocks) : el('p', { class: 'muted' }, 'אין עדיין שאלונים במערכת.'),
    sentCount ? el('p', { class: 'muted small' }, 'לחיצה על שאלון פותחת את התשובות.') : null);
  window.scrollTo(0, 0);
}

// Inside an opened questionnaire: "טקסט" (default) | "סיכום לנועץ" | "תשובות הנועץ" | "העתקה"
function answerViews(q, client) {
  const text = el('div', { class: 'answers' }, q.summary || '—');
  const canShow = !!(q.page && q.state && typeof CFL_HR_CLIENT_SITE === 'string');
  const panes = { text: text };
  const tabs = {};
  const copied = el('span', { class: 'copied', 'aria-live': 'polite' });

  function pick(key) {
    if (!panes[key]) { // the two page views are built the first time they're opened
      panes[key] = el('div', { class: 'visual' }, clientFrame(q, client, key === 'answers' ? 'view-answers' : 'view'));
      body.append(panes[key]);
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

  const body = el('div', { class: 'qbody' },
    el('div', { class: 'toolbar' },
      el('div', { class: 'segs' }, tab('text', 'טקסט'),
        canShow ? tab('results', 'סיכום לנועץ') : null,
        canShow ? tab('answers', 'תשובות הנועץ') : null),
      el('div', {}, copied, copyBtn)),
    text);
  return body;
}

// The questionnaire page from the נועצים site, read-only, fed with the saved answers from here.
// mode: 'view' = the summary screen, 'view-answers' = the questionnaire with the answers filled in
function clientFrame(q, client, mode) {
  const src = CFL_HR_CLIENT_SITE + q.page + '#' + mode;
  const origin = new URL(src, location.href).origin;
  const frame = el('iframe', { class: 'client-frame', title: q.title + ' – ' + (mode === 'view' ? 'סיכום לנועץ' : 'תשובות הנועץ'), src: src, loading: 'lazy' });
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin || !e.data || e.data.type !== 'cfl-view-ready') return;
    frame.contentWindow.postMessage({ type: 'cfl-view', state: q.state, submittedAt: q.sentAt, updatedAt: q.updatedAt,
      name: client.name, gender: client.gender }, origin);
  };
  window.addEventListener('message', onMsg);
  // Grow the frame with its content (both sites share the same address, so the height can be read)
  const fit = () => {
    if (!frame.isConnected) { clearInterval(timer); window.removeEventListener('message', onMsg); return; }
    try { const h = frame.contentDocument.documentElement.scrollHeight; if (h) frame.style.height = h + 'px'; } catch (e) { }
  };
  const timer = setInterval(fit, 400);
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
  loading('staff');
  const list = await api('staffList');
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
        addMsg.append(msgBox(name.value.trim() + ' נוסף/ה ליועצים. מעכשיו אפשר להיכנס עם חשבון ה-Google של ' + email.value.trim().toLowerCase() + '.', 'success'));
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

// ===================== Start =====================
if (CFL_HR_API_URL.indexOf('PASTE_') === 0) {
  render(msgBox('ממשק היועצים עדיין לא חובר לשרת: יש להדביק את כתובת ה-Web App בקובץ CFL_HR_config.js.'));
} else if (getToken()) {
  showHome();
} else {
  showLogin();
}
