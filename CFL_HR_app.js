// חוזה עם החיים (CFL) – ממשק צוות, צד לקוח
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
  let out;
  try { out = await res.json(); } catch (e) { return { ok: false, message: 'תקלה בשרת. נסו שוב מאוחר יותר.' }; }
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
    el('h1', {}, 'כניסה לצוות'),
    el('p', { class: 'sub' }, 'הכניסה עם חשבון Google, לאנשי צוות מורשים בלבד.'),
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

// ===================== Home: staff list + add staff =====================
async function showHome(notice) {
  render(el('p', { class: 'loading' }, 'טוען…'));
  if (!me) {
    const r = await api('hrMe');
    if (!r.ok) { if (!r.handled) showLogin(r.message); return; }
    me = { name: r.name, email: r.email };
  }
  navName.textContent = me.name || me.email;
  logoutBtn.hidden = false;

  const list = await api('staffList');
  if (!list.ok) { if (!list.handled) render(msgBox(list.message)); return; }

  const tableBox = el('div');
  drawStaff(tableBox, list.staff);

  const addMsg = el('div');
  const email = el('input', { type: 'email', dir: 'ltr', required: true, placeholder: 'name@gmail.com' });
  const name = el('input', { type: 'text', required: true, maxlength: '60' });
  const addBtn = el('button', { type: 'submit', class: 'btn primary' }, 'הוספה');
  const form = el('form', {
    class: 'add-form', hidden: true,
    onsubmit: async (e) => {
      e.preventDefault();
      addMsg.replaceChildren();
      await withBusy(addBtn, async () => {
        const r = await api('staffAdd', { email: email.value, name: name.value });
        if (!r.ok) { if (!r.handled) addMsg.append(msgBox(r.message)); return; }
        drawStaff(tableBox, r.staff);
        addMsg.append(msgBox(name.value.trim() + ' נוסף/ה לצוות. מעכשיו אפשר להיכנס עם חשבון ה-Google של ' + email.value.trim().toLowerCase() + '.', 'success'));
        email.value = ''; name.value = '';
        form.hidden = true;
        openBtn.hidden = false;
      });
    }
  },
    field('אימייל של חשבון Google', email),
    field('שם מלא', name),
    el('p', { class: 'hint' }, 'יש להזין את הכתובת בדיוק כמו בחשבון ה-Google של חבר/ת הצוות.'),
    el('div', { class: 'row' }, addBtn,
      el('button', { type: 'button', class: 'btn secondary', onclick: () => { form.hidden = true; openBtn.hidden = false; } }, 'ביטול')));
  const openBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => { form.hidden = false; openBtn.hidden = true; email.focus(); } }, 'הוסף חבר צוות');

  render(
    notice ? msgBox(notice, 'success') : null,
    el('h1', {}, 'שלום, ' + (me.name || me.email)),
    el('p', { class: 'sub' }, 'ממשק הצוות. כאן יתווספו בהמשך הלקוחות והשאלונים שלהם.'),
    el('div', { class: 'card' },
      el('h2', {}, 'חברי צוות'),
      tableBox, addMsg, openBtn, form)
  );
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
  render(msgBox('ממשק הצוות עדיין לא חובר לשרת: יש להדביק את כתובת ה-Web App בקובץ CFL_HR_config.js.'));
} else if (getToken()) {
  showHome();
} else {
  showLogin();
}
