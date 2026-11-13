'use strict';
const api = window.mendkit;
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

const SCREENS = [
  { id: 'dashboard', name: 'Dashboard', simple: true },
  { id: 'repair', name: 'Repair', simple: false },
  { id: 'tools', name: 'Tools', simple: false },
  { id: 'migrate', name: 'Migrate', simple: true },
  { id: 'tweaks', name: 'Tweaks', simple: false },
  { id: 'updates', name: 'Updates', simple: true },
  { id: 'hardware', name: 'Hardware Tests', simple: true },
  { id: 'crash', name: 'Crash Analyzer', simple: true },
  { id: 'setup', name: 'Setup Profiles', simple: false },
  { id: 'drive', name: 'Backup & Erase', simple: false },
  { id: 'reinstall', name: 'Reinstall assistant', simple: false, hidden: true },
  { id: 'isos', name: 'ISO Library', simple: true },
  { id: 'undo', name: 'Undo Center', simple: true },
  { id: 'guides', name: 'How-To Guides', simple: true },
  { id: 'reports', name: 'Reports', simple: true },
];

const state = { mode: 'simple', screen: 'dashboard', info: null, catalog: null, running: false, toolStatus: null, symptoms: [], guide: null };

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  for (const s of SCREENS) {
    if ((state.mode === 'simple' && !s.simple) || s.hidden) continue;
    const a = el('a', { textContent: s.name, className: (s.id === state.screen ? 'active ' : '') + (s.soon ? 'soon' : '') });
    a.onclick = () => show(s.id);
    nav.append(a);
  }
  $('#techToggle').checked = state.mode === 'technician';
  document.body.classList.toggle('simple', state.mode === 'simple');
  const badge = $('#adminBadge');
  const elevated = state.info && state.info.elevated;
  const posix = state.info && state.info.platform !== 'win32';
  badge.textContent = elevated ? 'Administrator' : posix ? 'Asks for password when needed' : 'Standard rights';
  badge.className = 'badge ' + (elevated || posix ? 'ok' : 'warn');
}

function show(id) {
  // A hardware test left running would keep the camera or microphone on and swallow every key press.
  if (hwStop) {
    hwStop();
    hwStop = null;
  }
  const s = SCREENS.find((x) => x.id === id);
  state.screen = !s || (state.mode === 'simple' && !s.simple) ? 'dashboard' : id;
  renderNav();
  const view = $('#view');
  view.replaceChildren();
  const cur = SCREENS.find((x) => x.id === state.screen);
  if (cur.soon) {
    view.append(el('h1', { textContent: cur.name }), el('div', { className: 'placeholder', textContent: cur.soon }));
  } else if (cur.id === 'dashboard') renderDashboard(view);
  else if (cur.id === 'repair') renderRepair(view);
  else if (cur.id === 'updates') renderUpdates(view);
  else if (cur.id === 'guides') renderGuides(view);
  else if (cur.id === 'isos') renderIsos(view);
  else if (cur.id === 'hardware') renderHardware(view);
  else if (cur.id === 'setup') renderSetup(view);
  else if (cur.id === 'crash') renderCrash(view);
  else if (cur.id === 'drive') renderDrive(view);
  else if (cur.id === 'reinstall') renderReinstall(view);
  else if (cur.id === 'undo') renderUndo(view);
  else if (cur.id === 'tools') renderTools(view);
  else if (cur.id === 'tweaks') renderTweaks(view);
  else if (cur.id === 'migrate') renderMigrate(view);
  else if (cur.id === 'reports') renderReports(view);
  if (state.online === false && ['tools', 'updates', 'isos', 'setup'].includes(state.screen)) view.prepend(el('div', { className: 'notice offline' }, el('span', { textContent: 'This computer has no internet connection. Installs, updates and downloads will fail until it is back. Repairs, hardware tests, migration, tweaks and erasing still work.' })));
}

function card(k, v, cls) {
  return el('div', { className: 'card' }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v ' + (cls || ''), textContent: v }));
}

function adminNotice() {
  const btn = el('button', { textContent: 'Restart as administrator' });
  btn.onclick = async () => {
    btn.disabled = true;
    const r = await api.relaunchElevated();
    if (!r.ok) {
      btn.disabled = false;
      $('#runStatus').textContent = r.message;
    }
  };
  return el('div', { className: 'notice' }, el('span', { textContent: 'Most repair steps need administrator rights. Without them those steps are skipped.' }), btn);
}

function renderDashboard(view) {
  const i = state.info;
  view.append(el('h1', { textContent: 'Dashboard' }), el('p', { className: 'lead', textContent: 'A quick look at this computer.' }));
  const cards = el('div', { className: 'cards' });
  cards.append(card('Computer', i.hostname), card('System', i.osName), card('Processor', i.cpu), card('Memory', i.memoryGb + ' GB'));
  if (i.diskFreeGb !== null) {
    const low = i.diskFreeGb / i.diskTotalGb < 0.1;
    cards.append(card('System drive', `${i.diskFreeGb} GB free of ${i.diskTotalGb} GB`, low ? 'warn' : ''));
  }
  // Drive health takes a moment to read on Windows, so it is added when it arrives and kept for later visits.
  const driveCards = (list) => {
    const after = cards.querySelector('.card.last') || null;
    for (const d of list) cards.insertBefore(card(`${d.type || 'Drive'}: ${d.name}`, d.health, d.health === 'Healthy' ? 'good' : 'bad'), after);
  };
  if (state.drives) driveCards(state.drives);
  else
    api.systemDrives().then((list) => {
      state.drives = list;
      if (cards.isConnected) driveCards(list);
    });
  api.history().then((h) => {
    if (!cards.isConnected || !h.entries.length) return;
    const last = h.entries.find((e) => e.kind === 'recipe');
    if (!last) return;
    const c = card('Last serviced', `${new Date(last.startedAt).toLocaleDateString()}: ${last.title}`, last.overall === 'good' ? 'good' : 'warn');
    c.classList.add('last');
    cards.append(c);
  });
  view.append(cards);
  const specsBtn = el('button', { className: 'ghost', textContent: 'View all specs and temperatures' });
  const specsBox = el('div', { id: 'specs', hidden: true });
  specsBtn.onclick = () => {
    specsBox.hidden = !specsBox.hidden;
    specsBtn.textContent = specsBox.hidden ? 'View all specs and temperatures' : 'Hide specs and temperatures';
    if (!specsBox.hidden) loadSpecs(specsBox);
  };
  const helpBtn = el('button', { className: 'ghost', textContent: 'Get help' });
  helpBtn.onclick = () => showHelp();
  view.append(el('div', { className: 'specs-bar toolbar' }, specsBtn, helpBtn), specsBox);
  if (i.platform === 'win32' && !i.elevated) view.append(adminNotice());

  const std = state.catalog.recipes.find((r) => r.id === 'standard-service');
  if (std) {
    const btn = el('button', { className: 'big run', textContent: 'Fix my computer' });
    btn.onclick = () => showPreview(std.id);
    view.append(
      el('div', { className: 'hero' },
        el('div', {}, el('strong', { textContent: std.name }), el('p', { textContent: `${std.description} About ${std.typicalMinutes} minutes. You can keep using the computer while it runs.` })),
        btn),
    );
  }
  // Symptom picker: choose what is wrong and MendKit runs the matching checks and fixes.
  if (state.symptoms.length) {
    const grid = el('div', { className: 'symptoms' });
    for (const s of state.symptoms) {
      const b = el('button', { className: 'ghost run symptom', title: `${s.description} About ${s.minutes} min.` }, el('strong', { textContent: s.label }), el('small', { textContent: s.description }));
      b.onclick = () => showPreview(s.recipe, s.label);
      grid.append(b);
    }
    view.append(el('h2', { textContent: 'What is the problem?' }), grid);
  }
  const adv = el('button', { className: 'ghost run', textContent: 'Check this computer' });
  adv.onclick = () => run(async () => showResults(await api.advisor()));
  view.append(el('div', { className: 'hero slim' }, el('div', {}, el('strong', { textContent: 'Is this computer worth fixing?' }), el('p', { textContent: 'Looks at memory, drive type, age, battery and Windows 11 readiness, and gives a keep, upgrade or replace verdict. Changes nothing.' })), adv));
  const audit = el('button', { className: 'ghost', textContent: 'Check for remote access' });
  audit.onclick = () => showRemoteAudit();
  view.append(el('div', { className: 'hero slim' }, el('div', {}, el('strong', { textContent: 'Did someone connect to this computer?' }), el('p', { textContent: 'Scans for remote-control programs, which phone and pop-up scammers ask people to install. Shows what it finds first; nothing is removed unless you choose it.' })), audit));
  const viaSymptom = new Set(state.symptoms.map((s) => s.recipe));
  const quick = el('div', { className: 'cards' });
  for (const r of state.catalog.recipes.filter((x) => x.id !== 'standard-service' && x.simpleMode && !viaSymptom.has(x.id))) {
    const b = el('button', { className: 'ghost run', textContent: 'Run' });
    b.onclick = () => showPreview(r.id);
    quick.append(el('div', { className: 'card' }, el('div', { className: 'v', textContent: r.name }), el('p', { className: 'lead', textContent: r.description }), b));
  }
  view.append(el('h2', { textContent: 'Other fixes' }), quick);
  syncButtons();
}

let tempTimer = null;

async function paintTemps(box) {
  const r = await api.temps();
  if (!box.isConnected) return;
  box.replaceChildren();
  const cards = el('div', { className: 'cards' });
  for (const t of r.temps) {
    const f = Math.round(t.celsius * 9 / 5 + 32);
    cards.append(card(t.name, `${Math.round(t.celsius)} \u00b0C / ${f} \u00b0F`, t.celsius >= 90 ? 'bad' : t.celsius >= 75 ? 'warn' : 'good'));
  }
  if (r.temps.length) box.append(cards);
  else if (!r.note) box.append(el('p', { className: 'lead', textContent: 'No temperature readings are available yet.' }));
  if (r.note) box.append(el('p', { className: 'lead note', textContent: r.note }));
}

async function loadSpecs(box) {
  clearInterval(tempTimer);
  box.replaceChildren(el('p', { className: 'lead', textContent: 'Reading hardware details...' }));
  const tempBox = el('div');
  const sections = await api.specs();
  if (!box.isConnected || box.hidden) return;
  box.replaceChildren(el('h2', { textContent: 'Temperatures' }), tempBox);
  await paintTemps(tempBox);
  tempTimer = setInterval(() => {
    if (!tempBox.isConnected || box.hidden) return clearInterval(tempTimer);
    paintTemps(tempBox);
  }, 10000);
  for (const s of sections) {
    const t = el('table', { className: 'spec' });
    for (const r of s.rows) t.append(el('tr', {}, el('th', { textContent: r.k }), el('td', { textContent: r.v })));
    box.append(el('h2', { textContent: s.title }), t);
  }
}

function renderRepair(view) {
  view.append(el('h1', { textContent: 'Repair' }), el('p', { className: 'lead', textContent: 'Recipes run their steps in order. Single commands run on their own.' }));
  if (state.info.platform === 'win32' && !state.info.elevated) view.append(adminNotice());
  const override = el('input', { type: 'checkbox', id: 'override' });
  view.append(el('div', { className: 'toolbar' }, searchBar(view, 'Search recipes and commands')), noMatch());
  const auditBtn = el('button', { className: 'ghost', textContent: 'Remote access audit' });
  auditBtn.onclick = () => showRemoteAudit();
  view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Remote access audit: scans installed programs, running programs, services, Program Files and every user\'s AppData, Downloads, Desktop and Documents for remote-control tools, then lets you choose which to remove.' }), auditBtn));
  const reBtn = el('button', { className: 'ghost', textContent: 'Reinstall assistant' });
  reBtn.onclick = () => show('reinstall');
  view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Reinstall assistant: when repairs do not hold, reinstall the system over itself and keep files, apps and settings. MendKit checks the computer is ready and walks you through it.' }), reBtn));
  view.append(el('h2', { textContent: 'Recipes' }));
  const rt = el('table', { className: 'searchable' });
  for (const r of state.catalog.recipes) {
    const b = el('button', { className: 'run', textContent: 'Run' });
    b.onclick = () => showPreview(r.id, null, override.checked);
    rt.append(el('tr', { className: 'searchable' },
      el('td', {}, el('strong', { textContent: r.name }), el('br'), el('small', { textContent: `${r.description} ${r.steps.length} steps, about ${r.typicalMinutes} min.` })),
      el('td', { className: 'act' }, b)));
  }
  view.append(rt, el('label', { className: 'switch' }, override, 'Continue even if a restore point cannot be created'));

  view.append(el('h2', { textContent: 'Single commands' }));
  const ct = el('table', { className: 'searchable' });
  ct.append(el('tr', {}, el('th', { textContent: 'Command' }), el('th', { textContent: 'Time' }), el('th')));
  for (const c of state.catalog.commands) {
    const b = el('button', { className: 'ghost run', textContent: 'Run' });
    b.onclick = () => run(() => api.runCommand(c.id));
    const name = el('td', {}, el('strong', { textContent: c.name }));
    if (c.admin) name.append(el('span', { className: 'tag', textContent: 'admin' }));
    if (c.needsRestart) name.append(el('span', { className: 'tag', textContent: 'restart' }));
    name.append(el('br'), el('small', { textContent: c.description }));
    ct.append(el('tr', { className: 'searchable' }, name, el('td', { textContent: `~${c.typicalMinutes} min` }), el('td', { className: 'act' }, b)));
  }
  view.append(ct);
  syncButtons();
}

async function renderReports(view) {
  const open = el('button', { className: 'ghost', textContent: 'Open logs folder' });
  open.onclick = () => api.openLogs();
  const hist = await api.history();
  const m = hist.machine;
  const who = [m.maker, m.model].filter(Boolean).join(' ');
  const exp = el('button', { className: 'ghost', textContent: 'Export job history (CSV)' });
  exp.onclick = async () => {
    const f = await api.historyExport();
    if (f) migSafeStatus(`Job history saved to ${f}`);
  };
  view.append(el('h1', { textContent: 'Reports' }), el('p', { className: 'lead', textContent: `Every run on this computer is saved with its full output.${who || m.serial ? ` This computer: ${who || 'unknown model'}${m.serial ? `, serial ${m.serial}` : ''}.` : ''}` }), el('div', { className: 'toolbar' }, open, exp));
  const list = await api.reports();
  if (!list.length) return view.append(el('div', { className: 'placeholder', textContent: 'Nothing has been run yet.' }));
  const t = el('table');
  t.append(el('tr', {}, el('th', { textContent: 'When' }), el('th', { textContent: 'Job' }), el('th', { textContent: 'Result' }), el('th')));
  for (const r of list) {
    const ok = r.steps.filter((s) => s.status === 'ok').length;
    const acts = el('td', { className: 'act' });
    const v = el('button', { className: 'ghost', textContent: 'View results' });
    v.onclick = () => showResults(r);
    acts.append(v);
    if (state.mode === 'technician') {
      const b = el('button', { className: 'ghost', textContent: 'View log' });
      b.onclick = () => showLog(r);
      acts.append(' ', b);
    }
    const res = state.mode === 'simple' ? HEADLINES[r.overall || 'attention'] : `${r.outcome}, ${ok} of ${r.steps.length} steps OK${r.needsRestart ? ', restart needed' : ''}`;
    t.append(el('tr', {},
      el('td', { textContent: new Date(r.startedAt).toLocaleString() }),
      el('td', { textContent: r.title }),
      el('td', { textContent: res, className: (r.overall ? r.overall === 'good' : r.outcome === 'completed' && ok === r.steps.length) ? 'good' : 'warn' }),
      acts));
  }
  view.append(t);
}

/** Preview: says in plain words what a recipe will do, before anything runs. */
function showPreview(recipeId, label, overrideGates) {
  const r = state.catalog.recipes.find((x) => x.id === recipeId);
  if (!r) return;
  const view = $('#view');
  view.replaceChildren();
  const needsAdmin = r.detail.some((d) => d.admin);
  const restart = r.detail.some((d) => d.needsRestart);
  view.append(el('h1', { textContent: label ? `${label}: ${r.name}` : r.name }), el('p', { className: 'lead', textContent: `${r.description} ${r.detail.length} step${r.detail.length === 1 ? '' : 's'}, about ${r.typicalMinutes} minutes. Nothing has run yet.` }));
  if (needsAdmin && state.info.platform === 'win32' && !state.info.elevated) view.append(adminNotice());
  if (restart) view.append(el('div', { className: 'notice' }, el('span', { textContent: 'The computer will need a restart afterwards to finish these changes.' })));
  const list = el('ol', { className: 'guide preview' });
  for (const d of r.detail) {
    const li = el('li', {}, el('strong', { textContent: d.name }), ` (about ${d.minutes} min)`);
    if (d.gate) li.append(el('span', { className: 'tag', textContent: 'must succeed to continue' }));
    if (d.needsRestart) li.append(el('span', { className: 'tag', textContent: 'restart' }));
    if (d.admin && state.mode === 'technician') li.append(el('span', { className: 'tag', textContent: 'admin' }));
    li.append(el('br'), el('span', { className: 'dim', textContent: d.description }));
    list.append(li);
  }
  const after = el('select', { className: 'text' }, el('option', { value: '', textContent: 'When it finishes: do nothing' }), el('option', { value: 'restart', textContent: 'When it finishes: restart the computer' }), el('option', { value: 'shutdown', textContent: 'When it finishes: shut down' }));
  const start = el('button', { className: 'big run', textContent: 'Start' });
  start.onclick = () => run(async () => {
    const summary = await api.runRecipe(r.id, !!overrideGates);
    showResults(summary);
    if (after.value && summary.outcome === 'completed') {
      await api.power(after.value);
      const cancel = el('button', { textContent: 'Cancel it' });
      cancel.onclick = async () => {
        await api.power('cancel');
        note.remove();
      };
      const note = el('div', { className: 'notice' }, el('span', { textContent: `The computer will ${after.value === 'restart' ? 'restart' : 'shut down'} in one minute.` }), cancel);
      $('#view').prepend(note);
    }
  });
  const back = el('button', { className: 'ghost', textContent: 'Back' });
  back.onclick = () => show(state.screen);
  view.append(el('h2', { textContent: 'What it will do, in order' }), list, el('div', { className: 'result-foot' }, start, ...(state.info.platform === 'win32' ? [after] : []), back), el('p', { className: 'lead note', textContent: 'You can leave it to run. MendKit shows a notification when it finishes if its window is not in front.' }));
  if (state.mode === 'technician') {
    const img = el('a', { className: 'link', textContent: 'Make a full backup image first' });
    img.onclick = () => show('drive');
    view.append(el('p', { className: 'lead note' }, img));
  }
  view.scrollTop = 0;
  syncButtons();
}

/** "Get help": pass the report to a technician and start a remote support session. */
async function showHelp(logFile) {
  const view = $('#view');
  const info = await api.helpInfo();
  view.replaceChildren();
  const c = info.contact;
  view.append(el('h1', { textContent: 'Get help' }), el('p', { className: 'lead', textContent: 'Send what MendKit found to a technician, and let them connect to this computer if you both agree.' }));
  if (c.name || c.email || c.phone) view.append(el('div', { className: 'card' }, el('div', { className: 'k', textContent: 'Your technician' }), el('div', { className: 'v', textContent: [c.name, c.phone, c.email].filter(Boolean).join('  |  ') })));
  else view.append(el('p', { className: 'lead note', textContent: 'No technician contact is saved yet. You can still email the report to anyone you choose.' }));
  const text = await api.helpText(logFile);
  const mail = el('button', { textContent: 'Email this report' });
  mail.onclick = () => api.helpEmail(logFile);
  const copy = el('button', { className: 'ghost', textContent: 'Copy report text' });
  copy.onclick = async () => {
    await navigator.clipboard.writeText(text);
    migSafeStatus('Report text copied. Paste it into a message to your technician.');
  };
  view.append(el('h2', { textContent: '1. Send the report' }), el('p', { className: 'lead', textContent: 'Email opens a draft in your own mail program. Nothing is sent until you press Send.' }), el('div', { className: 'toolbar' }, mail, copy), el('pre', { className: 'report-text', textContent: text }));
  view.append(el('h2', { textContent: '2. Remote support' }));
  if (info.rustdesk) {
    const rd = el('button', { textContent: 'Open RustDesk' });
    rd.onclick = () => api.helpRustdesk();
    view.append(el('p', { className: 'lead', textContent: 'Open RustDesk and read the ID and one-time password on its left side to your technician. You can watch everything they do and close the connection at any time.' }), el('div', { className: 'toolbar' }, rd));
  } else if (info.canInstallRustdesk) {
    const ins = el('button', { className: 'run', textContent: 'Install RustDesk' });
    ins.onclick = () => run(async () => {
      await api.helpInstallRustdesk();
      showHelp(logFile);
    });
    view.append(el('p', { className: 'lead', textContent: 'RustDesk is a free remote support program. It is not installed on this computer yet.' }), el('div', { className: 'toolbar' }, ins));
  } else view.append(el('p', { className: 'lead', textContent: 'RustDesk is not installed. Download it from rustdesk.com.' }));
  view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Only share the ID and password with someone you contacted yourself. A caller or pop-up that asks you to install a remote tool is a scam.' })));
  if (state.mode === 'technician') {
    const f = (ph, v) => el('input', { type: 'text', className: 'text', placeholder: ph, value: v });
    const [n, ph, em] = [f('Name or shop', c.name), f('Phone', c.phone), f('Email', c.email)];
    const save = el('button', { className: 'ghost', textContent: 'Save contact' });
    save.onclick = async () => {
      try {
        await api.helpSetContact({ name: n.value, phone: ph.value, email: em.value });
        showHelp(logFile);
      } catch (err) {
        migSafeStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    };
    view.append(el('h2', { textContent: 'Technician contact (Technician mode)' }), el('div', { className: 'toolbar' }, n, ph, em, save));
  }
  const back = el('button', { className: 'ghost', textContent: 'Back to Dashboard' });
  back.onclick = () => show('dashboard');
  view.append(el('div', { className: 'result-foot' }, back));
  view.scrollTop = 0;
  syncButtons();
}

/** A search box that hides the rows (and empty groups) of the screen's tables that do not match. */
function searchBar(view, placeholder) {
  const input = el('input', { type: 'search', className: 'text search', placeholder });
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    for (const row of view.querySelectorAll('tr.searchable')) row.hidden = !!q && !row.textContent.toLowerCase().includes(q);
    for (const t of view.querySelectorAll('table.searchable')) {
      const any = [...t.querySelectorAll('tr.searchable')].some((r) => !r.hidden);
      t.hidden = !any;
      const head = t.previousElementSibling;
      if (head && head.tagName === 'H2') head.hidden = !any;
    }
    const none = view.querySelector('.no-match');
    if (none) none.hidden = [...view.querySelectorAll('tr.searchable')].some((r) => !r.hidden);
  };
  return input;
}
const noMatch = () => el('p', { className: 'lead no-match', textContent: 'Nothing matches that search.', hidden: true });

const HEADLINES = { good: 'Everything looks good', attention: 'A few things need attention', problem: 'MendKit found a problem' };
const ICONS = { good: '\u2713', info: 'i', attention: '!', problem: '\u2715', skipped: '\u2013' };
const ORDER = ['problem', 'attention', 'skipped', 'info', 'good'];

async function showLog(r) {
  $('#stepList').replaceChildren();
  $('#output').textContent = await api.reportLog(r.logFile);
  outChars = $('#output').textContent.length;
  $('#runStatus').textContent = `Log: ${r.title}, ${new Date(r.startedAt).toLocaleString()}`;
}

/** Plain-language results screen. Technician mode adds the raw details and a log button. */
function showResults(r) {
  const view = $('#view');
  view.replaceChildren();
  const overall = r.overall || 'attention';
  const steps = r.steps.map((s) => ({ ...s, friendly: s.friendly || { level: s.status === 'ok' ? 'good' : 'problem', title: s.name, message: s.note || s.status } }));
  const count = (lvl) => steps.filter((s) => s.friendly.level === lvl).length;
  const parts = [];
  if (count('good') + count('info')) parts.push(`${count('good') + count('info')} fine`);
  if (count('attention')) parts.push(`${count('attention')} to look at`);
  if (count('problem')) parts.push(`${count('problem')} with a problem`);
  if (count('skipped')) parts.push(`${count('skipped')} skipped`);
  view.append(
    el('div', { className: 'result-head ' + overall },
      el('div', { className: 'icon big ' + overall, textContent: ICONS[overall] }),
      el('div', {}, el('h1', { textContent: HEADLINES[overall] }), el('p', { className: 'lead', textContent: `${r.title}, ${new Date(r.startedAt).toLocaleString()}. ${steps.length} check${steps.length === 1 ? '' : 's'}: ${parts.join(', ')}.` }))),
  );
  if (r.outcome === 'stopped') view.append(el('div', { className: 'notice' }, el('span', { textContent: 'MendKit stopped early to stay safe. Nothing after the failed step was run.' })));
  if (r.outcome === 'cancelled') view.append(el('div', { className: 'notice' }, el('span', { textContent: 'This run was cancelled before it finished.' })));
  if (r.needsRestart) view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Restart your computer to finish these changes.' })));
  if (steps.some((s) => s.status === 'needs-admin') && state.info.platform === 'win32' && !state.info.elevated) view.append(adminNotice());

  const list = el('div', { className: 'results' });
  for (const s of [...steps].sort((a, b) => ORDER.indexOf(a.friendly.level) - ORDER.indexOf(b.friendly.level))) {
    const body = el('div', {}, el('strong', { textContent: s.friendly.title }), el('p', { textContent: s.friendly.message }));
    if (state.mode === 'technician') {
      body.append(el('small', { textContent: `${s.name}: ${s.status}${s.exitCode !== null ? `, exit code ${s.exitCode}` : ''}${s.note ? `, ${s.note}` : ''}, ${s.seconds}s` }));
    }
    list.append(el('div', { className: 'result ' + s.friendly.level }, el('div', { className: 'icon ' + s.friendly.level, textContent: ICONS[s.friendly.level] }), body));
  }
  view.append(list);
  const back = el('button', { textContent: 'Back to Dashboard' });
  back.onclick = () => show('dashboard');
  const foot = el('div', { className: 'result-foot' }, back);
  if (r.logFile) {
    const pdf = el('button', { className: 'ghost', textContent: 'Save customer report (PDF)' });
    pdf.onclick = async () => {
      migSafeStatus('Building the report...');
      try {
        const out = await api.customerReport(r.logFile);
        migSafeStatus(out ? `Report saved to ${out.file}. Health score ${out.score} out of 100.` : 'Report not saved.');
      } catch (err) {
        migSafeStatus('The report could not be made: ' + String(err.message || err));
      }
    };
    foot.append(pdf);
  }
  if (overall !== 'good') {
    const help = el('button', { className: 'ghost', textContent: 'Get help' });
    help.onclick = () => showHelp(r.logFile);
    foot.append(help);
  }
  if (state.mode === 'technician') {
    const lg = el('button', { className: 'ghost', textContent: 'View full log' });
    lg.onclick = () => showLog(r);
    foot.append(lg);
  }
  view.append(foot);
  view.scrollTop = 0;
}

// ---------- How-To Guides ----------

async function renderGuides(view) {
  const guides = await api.guides();
  if (state.screen !== 'guides') return;
  const open = guides.find((g) => g.id === state.guide);
  if (open) {
    const back = el('button', { className: 'ghost', textContent: 'All guides' });
    back.onclick = () => {
      state.guide = null;
      show('guides');
    };
    view.append(el('div', { className: 'toolbar' }, back), el('h1', { textContent: open.title }), el('p', { className: 'lead', textContent: open.summary + (open.systems ? ` Works on: ${open.systems}.` : '') }));
    for (const sec of open.sections) {
      view.append(el('h2', { textContent: sec.heading }));
      const list = el(sec.heading === 'How to run it' ? 'ol' : 'ul', { className: 'guide' });
      for (const step of sec.steps) list.append(el('li', { textContent: step }));
      view.append(list);
    }
    view.scrollTop = 0;
    return;
  }
  view.append(el('h1', { textContent: 'How-To Guides' }), el('p', { className: 'lead', textContent: 'Step-by-step instructions for MendKit and for every tool in the Tools screen.' }));
  const search = el('input', { type: 'text', className: 'text', placeholder: 'Search the guides' });
  const holder = el('div');
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    holder.replaceChildren();
    for (const group of [...new Set(guides.map((g) => g.group))]) {
      const hits = guides.filter((g) => g.group === group && (!q || `${g.title} ${g.summary} ${g.sections.map((x) => x.steps.join(' ')).join(' ')}`.toLowerCase().includes(q)));
      if (!hits.length) continue;
      holder.append(el('h2', { textContent: group === 'Tools' ? 'Tool guides' : group }));
      const cards = el('div', { className: 'cards' });
      for (const g of hits) {
        const c = el('div', { className: 'card guide-card' }, el('strong', { textContent: g.title }), el('p', { className: 'lead', textContent: g.summary }));
        c.onclick = () => {
          state.guide = g.id;
          show('guides');
        };
        cards.append(c);
      }
      holder.append(cards);
    }
    if (!holder.children.length) holder.append(el('p', { className: 'lead', textContent: 'No guide matches that search.' }));
  };
  search.oninput = paint;
  view.append(search, holder);
  paint();
}

// ---------- Remote access audit ----------

async function showRemoteAudit() {
  const view = $('#view');
  view.replaceChildren();
  const back = el('button', { className: 'ghost', textContent: 'Back' });
  back.onclick = () => show(state.screen);
  view.append(el('h1', { textContent: 'Remote access audit' }), el('p', { className: 'lead', textContent: 'Looks for programs that let someone else see or control this computer. Scammers ask people to install these; technicians and IT departments also use them legitimately. The scan only looks. You decide what to remove.' }));
  const status = el('p', { className: 'lead mig-status' });
  const holder = el('div');
  const scan = el('button', { className: 'big', textContent: 'Scan this computer' });
  view.append(el('div', { className: 'toolbar' }, scan, back), status, holder);
  if (state.info.platform === 'win32' && !state.info.elevated) view.insertBefore(adminNotice(), status);

  scan.onclick = async () => {
    if (state.running) return migSafeStatus('MendKit is busy with another job. Wait for it to finish first.');
    scan.disabled = true;
    status.textContent = 'Scanning installed programs, running programs, services and program folders. This can take a few minutes...';
    setProgress(0.5);
    let r;
    try {
      r = await api.remoteScan();
    } catch (err) {
      status.textContent = 'The scan could not finish: ' + String(err.message || err);
      scan.disabled = false;
      return setProgress(null);
    }
    setProgress(null);
    scan.disabled = false;
    scan.textContent = 'Scan again';
    holder.replaceChildren();
    const found = r.findings;
    if (!found.length) {
      status.textContent = '';
      holder.append(el('div', { className: 'result-head good' }, el('div', { className: 'icon big good', textContent: ICONS.good }), el('div', {}, el('h1', { textContent: 'No remote access programs found' }), el('p', { className: 'lead', textContent: `MendKit checked for ${r.known} known remote-control products and found none installed, running or sitting in the usual folders.${r.elevated || state.info.platform !== 'win32' ? '' : ' Other users\' folders were not checked because MendKit is not running as administrator.'}` }))));
      return;
    }
    status.textContent = `Found ${found.length} remote access program${found.length === 1 ? '' : 's'}. Tick the ones you do not recognise or no longer want.`;
    const picks = [];
    for (const f of found) {
      const box = el('input', { type: 'checkbox', disabled: f.builtin || !r.canRemove });
      picks.push({ id: f.id, box });
      const lines = [];
      for (const i of f.installed) lines.push(`Installed: ${i.name}${i.publisher ? ` (${i.publisher})` : ''}${i.location ? `, in ${i.location}` : ''}`);
      for (const p of f.running) lines.push(`Running now: ${p.path}`);
      for (const s of f.services) lines.push(`Service: ${s.display} (${s.state || 'unknown'}, starts ${String(s.start || 'unknown').toLowerCase()})`);
      for (const p of f.files) lines.push(`Program file: ${p}`);
      const body = el('div', {}, el('strong', { textContent: f.name }));
      if (f.running.length) body.append(el('span', { className: 'tag hot', textContent: 'running now' }));
      if (f.services.some((s) => /auto/i.test(s.start))) body.append(el('span', { className: 'tag hot', textContent: 'starts with the computer' }));
      if (f.builtin) body.append(el('span', { className: 'tag', textContent: 'part of Windows' }));
      if (f.note) body.append(el('p', { className: 'dim', textContent: f.note }));
      const ul = el('ul', { className: 'found' });
      for (const l of lines) ul.append(el('li', { textContent: l }));
      body.append(ul);
      holder.append(el('div', { className: 'result ' + (f.running.length ? 'attention' : '') }, el('div', { className: 'chk' }, box), body));
    }
    if (!r.canRemove) {
      holder.append(el('p', { className: 'lead note', textContent: 'Removal is built for Windows so far. On this system, remove the ones you do not want with the system\'s own uninstaller.' }));
      return;
    }
    const remove = el('button', { className: 'big run', textContent: 'Remove selected' });
    remove.onclick = () => {
      const ids = picks.filter((p) => p.box.checked).map((p) => p.id);
      if (!ids.length) return migSafeStatus('Tick at least one program to remove.');
      const names = found.filter((f) => ids.includes(f.id)).map((f) => f.name);
      holder.replaceChildren(
        el('h2', { textContent: `Remove ${names.length} program${names.length === 1 ? '' : 's'}?` }),
        el('ul', { className: 'guide' }, ...names.map((n) => el('li', { textContent: n }))),
        el('p', { className: 'lead', textContent: 'MendKit will close each one, stop and disable its service, run its own uninstaller, and move any loose copies of its program file into a quarantine folder. Quarantined files can be put back from the Undo Center. An uninstaller window may open and ask you to confirm.' }),
      );
      const go = el('button', { className: 'big run', textContent: 'Yes, remove them' });
      go.onclick = () => run(async () => {
        const summary = await api.remoteRemove(ids);
        showResults(summary);
        $('#view').append(el('div', { className: 'notice' }, el('span', { textContent: 'If a stranger had access: restart the computer and scan again, then change your email and banking passwords from a different device, and call your bank if you entered or showed any account details.' })));
      });
      const cancel = el('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.onclick = () => showRemoteAudit();
      holder.append(el('div', { className: 'result-foot' }, go, cancel));
      status.textContent = '';
      syncButtons();
    };
    holder.append(el('div', { className: 'result-foot' }, remove), el('p', { className: 'lead note', textContent: 'Keep any program your own technician, employer or family set up. If you are not sure who installed something, ask before removing it.' }));
    syncButtons();
  };
  view.scrollTop = 0;
}

// ---------- ISO Library ----------

async function renderIsos(view) {
  view.append(el('h1', { textContent: 'ISO Library' }), el('p', { className: 'lead', textContent: 'Installer and rescue images worth keeping on a technician USB stick. Tick the ones you want and MendKit opens each official download page, so you always get the current version from the publisher.' }));
  const isos = await api.isos();
  if (state.screen !== 'isos') return;
  if (state.mode === 'technician') await usbCard(view);
  if (state.screen !== 'isos') return;
  const boxes = [];
  const go = el('button', { className: 'primary', textContent: 'Open selected download pages' });
  const count = () => {
    const n = boxes.filter((b) => b.box.checked).length;
    go.textContent = n ? `Open ${n} download page${n === 1 ? '' : 's'}` : 'Open selected download pages';
  };
  const all = el('button', { className: 'ghost', textContent: 'Select all' });
  const none = el('button', { className: 'ghost', textContent: 'Clear selection' });
  const setAll = (on) => {
    // Select all only ticks what the search is showing.
    for (const b of boxes) if (!on || !b.row.hidden) b.box.checked = on;
    count();
  };
  all.onclick = () => setAll(true);
  none.onclick = () => setAll(false);
  go.onclick = async () => {
    const ids = boxes.filter((b) => b.box.checked).map((b) => b.id);
    if (!ids.length) return migSafeStatus('Tick at least one item first.');
    const n = await api.isoOpen(ids);
    migSafeStatus(`Opened ${n} download page${n === 1 ? '' : 's'} in your browser.`);
  };
  view.append(el('div', { className: 'toolbar' }, searchBar(view, 'Search the ISO library'), all, none, go), noMatch());
  for (const group of [...new Set(isos.map((i) => i.group))]) {
    view.append(el('h2', { textContent: group }));
    const t = el('table', { className: 'searchable' });
    for (const i of isos.filter((x) => x.group === group)) {
      const box = el('input', { type: 'checkbox' });
      box.onchange = count;
      boxes.push({ id: i.id, box });
      const one = el('button', { className: 'ghost', textContent: 'Open page' });
      one.onclick = () => api.isoOpen([i.id]);
      const row = el('tr', { className: 'searchable' }, el('td', { className: 'chk' }, box), el('td', {}, el('strong', { textContent: i.name }), el('span', { className: 'tag', textContent: i.size }), el('span', { className: 'tag', textContent: i.site }), el('br'), el('small', { textContent: i.description })), el('td', { className: 'act' }, one));
      boxes[boxes.length - 1].row = row;
      t.append(row);
    }
    view.append(t);
  }
  const guide = el('button', { className: 'ghost', textContent: 'How to make the USB stick' });
  guide.onclick = () => {
    state.guide = 'ventoy';
    show('guides');
  };
  view.append(el('div', { className: 'notice' }, el('span', { textContent: 'To use these, install Ventoy on a USB stick once, then copy the ISO files onto it. The stick then offers a menu of them at startup.' }), guide));
}

async function usbCard(view) {
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const info = await api.usbInfo();
  const box = el('div', { className: 'card up' }, el('strong', { textContent: 'Build a technician USB' }), el('p', { className: 'lead', textContent: `Copies a portable MendKit (runs on ${info.system} with nothing to install, and keeps its logs on the stick) and your downloaded ISO files onto a USB stick. Put Ventoy on the stick first if you want it to start computers from the ISOs.` }));
  if (info.portable) box.append(el('p', { className: 'lead note', textContent: `This is a portable copy. Its settings and logs are kept in ${info.dataDir}.` }));
  const target = el('span', { className: 'dim', textContent: 'No drive chosen' });
  let chosen = null;
  const pick = el('button', { className: 'ghost', textContent: 'Choose the USB stick' });
  pick.onclick = async () => {
    try {
      const t = await api.usbPick();
      if (!t) return;
      chosen = t;
      target.textContent = `${t.dir} (${t.free} free)${t.ventoy ? ', Ventoy found' : ''}`;
      target.className = '';
    } catch (err) {
      migSafeStatus(errText(err));
    }
  };
  const appBox = el('input', { type: 'checkbox', checked: info.canCopyApp, disabled: !info.canCopyApp });
  const list = el('div', { className: 'ticks' });
  let isoBoxes = [];
  const paint = (items) => {
    isoBoxes = items.map((i) => ({ path: i.path, box: el('input', { type: 'checkbox', checked: true }), name: `${i.name} (${i.size})` }));
    list.replaceChildren(el('label', { className: 'switch' }, appBox, `Portable MendKit (${info.appSize})`), ...isoBoxes.map((b) => el('label', { className: 'switch' }, b.box, b.name)));
  };
  paint(info.isos);
  const add = el('button', { className: 'ghost', textContent: 'Add ISO files' });
  add.onclick = async () => paint(await api.usbAddIsos());
  const go = el('button', { className: 'run', textContent: 'Copy to the stick' });
  go.onclick = () => {
    if (!chosen) return migSafeStatus('Choose the USB stick first.');
    run(async () => showResults(await api.usbBuild(appBox.checked, isoBoxes.filter((b) => b.box.checked).map((b) => b.path))), api.usbCancel);
  };
  box.append(el('div', { className: 'toolbar' }, pick, target), list, el('p', { className: 'lead note', textContent: info.isos.length ? 'ISO files found in your Downloads folder are listed. Nothing already on the stick is removed.' : 'No ISO files were found in your Downloads folder. Download some from the list below, then use Add ISO files.' }), el('div', { className: 'toolbar' }, add, go));
  view.append(box);
  syncButtons();
}

// ---------- Reinstall assistant ----------

async function renderReinstall(view) {
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  view.append(el('h1', { textContent: 'Reinstall assistant' }), el('p', { className: 'lead', textContent: 'Checking this computer...' }));
  const info = await api.reinstallInfo();
  if (state.screen !== 'reinstall') return;
  view.lastChild.textContent = `Reinstalls the system over itself when repairs do not hold. This computer: ${info.system}.`;
  view.append(el('h2', { textContent: 'Before you start' }));
  const list = el('div', { className: 'results' });
  for (const c of info.checks) list.append(el('div', { className: 'result ' + c.level }, el('div', { className: 'icon ' + c.level, textContent: ICONS[c.level] }), el('div', {}, el('p', { className: 'plain', textContent: c.text }))));
  const img = el('button', { className: 'ghost', textContent: 'Make a backup image' });
  img.onclick = () => show('drive');
  const files = el('button', { className: 'ghost', textContent: 'Back up files to a drive' });
  files.onclick = () => {
    mig.role = 'backup';
    show('migrate');
  };
  view.append(list, el('div', { className: 'toolbar' }, img, files));
  const steps = (items) => el('ol', { className: 'guide' }, ...items.map((t) => el('li', { textContent: t })));
  if (info.platform === 'win32') {
    const rec = el('button', { className: 'run', textContent: 'Open Windows Recovery settings' });
    rec.onclick = () => api.reinstallOpenRecovery();
    view.append(el('div', { className: 'card up' }, el('strong', { textContent: 'Option 1: Reinstall through Windows Update (easiest)' }), el('p', { className: 'lead', textContent: 'Windows 11 (23H2 and later) can download a fresh copy of itself and reinstall, keeping files, apps and settings. It needs a working internet connection and takes about an hour.' }), steps(['Click the button below.', 'Next to "Fix problems using Windows Update", click "Reinstall now".', 'Leave the computer plugged in. It restarts by itself when it is ready.']), el('div', { className: 'toolbar' }, rec)));
    const chosen = el('span', { className: 'dim', textContent: 'No ISO chosen' });
    const pick = el('button', { className: 'ghost', textContent: 'Choose the Windows ISO' });
    const go = el('button', { className: 'run', textContent: 'Start the repair install' });
    let have = false;
    pick.onclick = async () => {
      const f = await api.reinstallPickIso();
      if (!f) return;
      have = true;
      chosen.textContent = `${f.path} (${f.size})`;
      chosen.className = '';
    };
    go.onclick = async () => {
      if (!have) return migSafeStatus('Choose the Windows ISO file first.');
      try {
        const r = await api.reinstallStart();
        migSafeStatus(`Windows Setup was started from drive ${r.letter}:. Follow the steps listed under Option 2.`);
      } catch (err) {
        migSafeStatus(errText(err));
      }
    };
    const iso = el('button', { className: 'ghost', textContent: 'Get a Windows ISO' });
    iso.onclick = () => show('isos');
    view.append(el('div', { className: 'card up' }, el('strong', { textContent: 'Option 2: Repair install from a Windows ISO' }), el('p', { className: 'lead', textContent: `Use this on Windows 10, when Option 1 is missing or fails, or with no internet. The ISO must be the same Windows (10 or 11), the same language${info.lang ? ` (${info.lang})` : ''} and the same or a newer version, or Setup will not offer to keep apps.` }), el('div', { className: 'toolbar' }, iso, pick, chosen), steps(['Click "Start the repair install". MendKit opens the ISO and starts Windows Setup.', 'In Setup, choose "Change how Setup downloads updates" and "Not right now" if the computer is offline.', 'On "Choose what to keep", pick "Keep personal files and apps". If that choice is greyed out, the ISO does not match this Windows: stop and get the right one.', 'Click Install. The computer restarts several times over 30 to 90 minutes.', 'Afterwards, run Updates in MendKit, then check Device Manager for missing drivers.']), el('div', { className: 'toolbar' }, go)));
    view.append(el('div', { className: 'card up' }, el('strong', { textContent: 'If Windows will not start at all' }), el('p', { className: 'lead', textContent: 'Copy the files off first with Migrate, "Copy from an old drive" (from another computer), then install Windows fresh from a USB stick made with the ISO Library.' })));
  } else if (info.platform === 'darwin') {
    view.append(el('div', { className: 'card up' }, el('strong', { textContent: 'Reinstall macOS, keeping your files' }), el('p', { className: 'lead', textContent: 'macOS Recovery reinstalls the system without erasing your files, apps or settings, as long as you do not erase the disk first.' }), steps(['Make a Time Machine backup first.', 'Shut the Mac down.', 'Apple silicon: hold the power button until "Loading startup options" shows, then choose Options. Intel: turn it on and hold Command-R.', 'Choose "Reinstall macOS" and pick the usual startup disk. Do not open Disk Utility and do not erase anything.', 'Leave it plugged in and connected to the internet. It takes about an hour.'])));
  } else {
    const iso = el('button', { className: 'ghost', textContent: 'Open the ISO Library' });
    iso.onclick = () => show('isos');
    view.append(el('div', { className: 'card up' }, el('strong', { textContent: 'Reinstall Linux, keeping your home folder' }), el('p', { className: 'lead', textContent: 'How this works depends on the distribution. In every case, back up your home folder to another drive first.' }), steps(['Try the lighter fix first: in Repair, run the package repair and reinstall commands for your package manager.', 'Download the same distribution and version from the ISO Library and write it to a USB stick.', 'Start the computer from the stick and begin the installer.', 'Ubuntu and Mint offer "Reinstall" (keeps home and tries to keep apps). On others, choose manual partitioning, reuse the existing partitions and do not tick "format" on the one holding /home.', 'After it finishes, use Setup Profiles or Migrate to put apps and settings back.']), el('div', { className: 'toolbar' }, iso)));
  }
  syncButtons();
}

// ---------- Undo Center ----------

async function renderUndo(view) {
  view.append(el('h1', { textContent: 'Undo Center' }), el('p', { className: 'lead', textContent: 'Everything MendKit has changed on this computer, with a way to put each thing back.' }));
  const c = await api.changes();
  if (state.screen !== 'undo') return;
  const again = () => state.screen === 'undo' && show('undo');
  view.append(el('h2', { textContent: 'Settings MendKit changed' }));
  if (!c.tweaks.length) view.append(el('p', { className: 'lead', textContent: 'No settings are currently changed by MendKit.' }));
  else {
    const t = el('table');
    for (const tw of c.tweaks) {
      const b = el('button', { className: 'ghost run', textContent: 'Put back' });
      b.onclick = async () => {
        await run(() => api.undoTweak(tw.id));
        again();
      };
      t.append(el('tr', {}, el('td', {}, el('strong', { textContent: tw.name }), el('br'), el('small', { textContent: `Changed ${new Date(tw.appliedAt).toLocaleString()}` })), el('td', { className: 'act' }, b)));
    }
    view.append(t);
  }
  view.append(el('h2', { textContent: 'Tools MendKit installed' }));
  if (!c.tools.length) view.append(el('p', { className: 'lead', textContent: 'MendKit has not installed any tools that are still recorded.' }));
  else {
    const t = el('table');
    for (const tool of c.tools) {
      const b = el('button', { className: 'ghost run', textContent: 'Remove' });
      b.onclick = async () => {
        await run(() => api.undoTool(tool.id));
        again();
      };
      t.append(el('tr', {}, el('td', {}, el('strong', { textContent: tool.name }), el('br'), el('small', { textContent: `Installed ${new Date(tool.when).toLocaleString()}` })), el('td', { className: 'act' }, b)));
    }
    view.append(t);
  }
  const q = await api.quarantineList();
  if (q.length) {
    view.append(el('h2', { textContent: 'Files set aside by the remote access audit' }));
    const t = el('table');
    for (const f of q) {
      const b = el('button', { className: 'ghost', textContent: 'Put back' });
      b.onclick = async () => {
        try {
          migSafeStatus(`Put back ${await api.quarantineRestore(f.id)}`);
        } catch (err) {
          migSafeStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        }
        again();
      };
      t.append(el('tr', {}, el('td', {}, el('strong', { textContent: f.tool }), el('br'), el('small', { textContent: `${f.from}, set aside ${new Date(f.when).toLocaleString()}` })), el('td', { className: 'act' }, b)));
    }
    view.append(t);
  }
  view.append(el('h2', { textContent: 'Repairs and cleanups' }));
  if (c.systemRestore) {
    const sr = el('button', { textContent: 'Open System Restore' });
    sr.onclick = () => api.openSystemRestore();
    view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Repairs cannot be reversed one by one. MendKit saves a restore point named "MendKit before repair" first; System Restore takes Windows back to it. Your personal files are not affected. Deleted temporary files cannot be brought back.' }), sr));
  } else view.append(el('p', { className: 'lead', textContent: 'Repairs cannot be reversed one by one. Where a snapshot was taken first (Time Machine or Timeshift), restore from that snapshot.' }));
  if (c.jobs.length) {
    const t = el('table');
    t.append(el('tr', {}, el('th', { textContent: 'When' }), el('th', { textContent: 'Job' }), el('th', { textContent: 'Result' })));
    for (const j of c.jobs) t.append(el('tr', {}, el('td', { textContent: new Date(j.startedAt).toLocaleString() }), el('td', { textContent: j.title }), el('td', { textContent: HEADLINES[j.overall] || j.overall })));
    view.append(t);
  }
  syncButtons();
}

// ---------- MendKit's own updates ----------

function paintSelfUpdate(box, u) {
  box.id = 'selfUpdate';
  box.replaceChildren(el('strong', { textContent: 'MendKit itself' }));
  const line = {
    idle: `You have version ${u.current}.`,
    checking: 'Checking for a newer version...',
    none: `You have the latest version (${u.current}).`,
    available: `Version ${u.version} is available. You have ${u.current}.`,
    downloading: `Downloading version ${u.version}... ${u.percent || 0}%`,
    ready: `Version ${u.version} is downloaded and ready to install.`,
    error: u.message || 'The update check did not work.',
  }[u.status];
  box.append(el('p', { className: 'lead', textContent: line }));
  const bar = el('div', { className: 'toolbar' });
  if (u.status === 'available') {
    const b = el('button', { textContent: u.mode === 'auto' ? 'Download the update' : 'Get the new version' });
    b.onclick = async () => {
      await api.selfUpdateDownload();
      if (u.mode === 'manual') migSafeStatus('The download was opened in your browser. Close MendKit, then run the file it saves.');
    };
    bar.append(b);
    if (u.mode === 'manual') box.append(el('p', { className: 'lead note', textContent: 'This copy of MendKit cannot replace itself, so the new installer opens in your browser.' }));
  } else if (u.status === 'ready') {
    const b = el('button', { textContent: 'Restart and install' });
    b.onclick = async () => {
      if (state.running) return migSafeStatus('Wait for the current job to finish, then install the update.');
      try {
        await api.selfUpdateInstall();
      } catch (err) {
        migSafeStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    };
    bar.append(b, el('span', { className: 'dim', textContent: 'It also installs by itself the next time MendKit is closed.' }));
  } else if (u.status !== 'checking' && u.status !== 'downloading') {
    const b = el('button', { className: 'ghost', textContent: 'Check for a new version' });
    b.onclick = () => api.selfUpdateCheck();
    bar.append(b);
  }
  box.append(bar);
}

api.onSelfUpdate((u) => {
  const badge = $('#updateBadge');
  badge.hidden = !(u.status === 'available' || u.status === 'ready');
  badge.textContent = u.status === 'ready' ? 'Update ready to install' : `Update available: ${u.version}`;
  const box = $('#selfUpdate');
  if (box) paintSelfUpdate(box, u);
});

async function renderUpdates(view) {
  view.append(el('h1', { textContent: 'Updates' }), el('p', { className: 'lead', textContent: 'Check for and install updates for the system and your apps. Check shows what is available without changing anything.' }));
  const selfBox = el('div', { className: 'card up' });
  view.append(selfBox);
  paintSelfUpdate(selfBox, await api.selfUpdateState());
  const cats = await api.updateCategories();
  if (state.screen !== 'updates') return;
  if (!cats.length) return view.append(el('div', { className: 'placeholder', textContent: 'No update source was found on this computer.' }));
  if (state.info.platform === 'win32' && !state.info.elevated && cats.some((c) => c.hasInstall)) view.append(adminNotice());
  for (const c of cats) {
    const box = el('div', { className: 'card up' });
    box.append(el('strong', { textContent: c.name }), el('p', { className: 'lead', textContent: c.description }));
    const bar = el('div', { className: 'toolbar' });
    if (c.openWindowsUpdate) {
      const b = el('button', { textContent: 'Open Windows Update' });
      b.onclick = () => api.openWindowsUpdate();
      bar.append(b);
      box.append(bar);
      view.append(box);
      continue;
    }
    if (c.hasCheck) {
      const chk = el('button', { className: 'ghost run', textContent: 'Check' });
      chk.onclick = () => run(async () => showResults(await api.runUpdate(c.id, 'check')));
      bar.append(chk);
    }
    if (c.hasInstall) {
      const ins = el('button', { className: 'run', textContent: c.installLabel || 'Install updates' });
      ins.onclick = () => run(async () => showResults(await api.runUpdate(c.id, 'install')));
      bar.append(ins);
    }
    box.append(bar);
    view.append(box);
  }
  // Manufacturer driver tools (Windows)
  const dt = await api.driverTools();
  if (state.screen !== 'updates') return;
  if (dt.supported) {
    const box = el('div', { className: 'card up' }, el('strong', { textContent: 'Drivers from the manufacturer' }), el('p', { className: 'lead', textContent: dt.tools.length ? `The maker's own update tool is the safest source for BIOS, firmware and drivers${dt.maker ? ` on this ${dt.maker} computer` : ''}.` : 'No maker update tool is in the catalog for this computer. Windows Update\'s optional updates carry most maker drivers.' }));
    const bar = el('div', { className: 'toolbar' });
    for (const t of dt.tools) {
      const b = el('button', { className: 'run', textContent: `Install ${t.name}`, title: t.description });
      b.onclick = () => run(async () => showResults(await api.driverToolInstall(t.id)));
      const g = el('a', { className: 'link', textContent: 'How to use it' });
      g.onclick = () => {
        state.guide = t.id;
        show('guides');
      };
      bar.append(b, g);
    }
    const opt = el('button', { className: 'ghost', textContent: 'Open optional driver updates' });
    opt.onclick = () => api.openOptionalUpdates();
    bar.append(opt);
    box.append(bar);
    view.append(box);
  }
  // Scheduled light maintenance
  const sch = await api.scheduleStatus();
  if (state.screen !== 'updates') return;
  if (sch.supported) {
    const box = el('div', { className: 'card up' }, el('strong', { textContent: 'Monthly light maintenance' }), el('p', { className: 'lead', textContent: 'On the 1st of each month at noon, MendKit checks drive health, cleans up, scans for malware and looks at updates and backup. It stays silent unless something needs attention.' }));
    const upd = el('input', { type: 'checkbox', checked: sch.withUpdates });
    const state2 = el('span', { className: sch.enabled ? 'good' : 'dim', textContent: sch.enabled ? 'Scheduled' : 'Not scheduled' });
    const toggle = el('button', { textContent: sch.enabled ? 'Turn off' : 'Turn on' });
    const set = async (on) => {
      try {
        await api.scheduleSet(on, upd.checked);
        show('updates');
      } catch (err) {
        await show('updates');
        migSafeStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    };
    toggle.onclick = () => set(!sch.enabled);
    upd.onchange = () => sch.enabled && set(true);
    box.append(el('div', { className: 'toolbar' }, toggle, state2, el('label', { className: 'switch' }, upd, 'Also install app updates')));
    if (state.info.platform === 'win32' && !sch.elevated && !sch.enabled) box.append(el('p', { className: 'lead note', textContent: 'Turn it on while MendKit is running as administrator, or the monthly run will skip the cleanup and scan steps.' }));
    const now = el('button', { className: 'ghost run', textContent: 'Run it now' });
    now.onclick = () => showPreview(upd.checked ? 'light-maintenance-updates' : 'light-maintenance');
    box.append(el('div', { className: 'toolbar' }, now));
    view.append(box);
  }
  syncButtons();
}

// ---------- Setup Profiles ----------

async function renderSetup(view, editing) {
  const data = await api.profiles();
  if (state.screen !== 'setup') return;
  view.replaceChildren();
  if (editing) {
    const p = editing;
    const name = el('input', { type: 'text', className: 'text', placeholder: 'Profile name', value: p.name || '' });
    const desc = el('input', { type: 'text', className: 'text wide', placeholder: 'What it is for (optional)', value: p.description || '' });
    const group = (title, items, picked) => {
      const boxes = [];
      const grid = el('div', { className: 'ticks' });
      for (const it of items) {
        const box = el('input', { type: 'checkbox', checked: picked.includes(it.id) });
        boxes.push({ id: it.id, box });
        grid.append(el('label', { className: 'switch' + (it.available === false ? ' dim' : ''), title: it.available === false ? 'Not available on this kind of computer' : '' }, box, it.name));
      }
      view.append(el('h2', { textContent: title }), grid);
      return { ids: () => boxes.filter((b) => b.box.checked).map((b) => b.id), set: (ids) => boxes.forEach((b) => (b.box.checked = ids.includes(b.id))) };
    };
    view.append(el('h1', { textContent: p.id ? 'Edit profile' : 'New profile' }), el('div', { className: 'toolbar' }, name, desc));
    const apps = group('Apps to install', data.apps, p.apps || []);
    const detect = el('button', { className: 'ghost', textContent: 'Tick the apps installed on this computer' });
    detect.onclick = async () => {
      migSafeStatus('Looking at what is installed...');
      apps.set([...new Set([...apps.ids(), ...(await api.profileDetect())])]);
      migSafeStatus('Ticked the apps found on this computer.');
    };
    view.append(el('div', { className: 'toolbar' }, detect));
    const tools = group('Tools to install', data.tools, p.tools || []);
    const preset = el('select', { className: 'text' }, el('option', { value: '', textContent: 'No preset' }), ...data.presets.map((x) => el('option', { value: x.id, textContent: `${x.name} preset`, selected: p.tweakPreset === x.id })));
    view.append(el('h2', { textContent: 'Tweaks' }), el('div', { className: 'toolbar' }, preset));
    const tweaks = data.tweaks.length ? group('Extra tweaks', data.tweaks, p.tweaks || []) : { ids: () => p.tweaks || [] };
    const save = el('button', { textContent: 'Save profile' });
    save.onclick = async () => {
      if (!name.value.trim()) return migSafeStatus('Give the profile a name.');
      await api.profileSave({ id: p.builtin ? '' : p.id, name: name.value, description: desc.value, apps: apps.ids(), tools: tools.ids(), tweaks: tweaks.ids(), tweakPreset: preset.value });
      renderSetup(view);
    };
    const cancel = el('button', { className: 'ghost', textContent: 'Cancel' });
    cancel.onclick = () => renderSetup(view);
    view.append(el('div', { className: 'result-foot' }, save, cancel));
    view.scrollTop = 0;
    return;
  }
  view.append(el('h1', { textContent: 'Setup Profiles' }), el('p', { className: 'lead', textContent: 'A profile is a saved bundle of apps, tools and tweaks. Apply one to set up a new computer in a single run.' }));
  const add = el('button', { textContent: 'New profile' });
  add.onclick = () => renderSetup(view, { apps: [], tools: [], tweaks: [] });
  const imp = el('button', { className: 'ghost', textContent: 'Import' });
  imp.onclick = async () => {
    try {
      if (await api.profileImport()) renderSetup(view);
    } catch (err) {
      migSafeStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  view.append(el('div', { className: 'toolbar' }, add, imp));
  const nameOf = (list, id) => (list.find((x) => x.id === id) || { name: id }).name;
  for (const p of data.profiles) {
    const parts = [];
    if (p.apps.length) parts.push(`Apps: ${p.apps.map((id) => nameOf(data.apps, id)).join(', ')}`);
    const tools = p.tools.filter((id) => data.tools.some((t) => t.id === id));
    if (tools.length) parts.push(`Tools: ${tools.map((id) => nameOf(data.tools, id)).join(', ')}`);
    if (p.tweakPreset) parts.push(`Tweaks: ${nameOf(data.presets, p.tweakPreset)} preset${p.tweaks.length ? ` plus ${p.tweaks.length} more` : ''}`);
    else if (p.tweaks.length) parts.push(`Tweaks: ${p.tweaks.length}`);
    const apply = el('button', { className: 'run', textContent: 'Apply to this computer' });
    apply.onclick = () => run(async () => {
      const r = await api.profileApply(p.id);
      showResults(r.summary);
      if (r.unmatched.length) $('#view').append(el('div', { className: 'notice' }, el('span', { textContent: `Not available on this kind of computer, so not installed: ${r.unmatched.join(', ')}.` })));
    });
    const edit = el('button', { className: 'ghost', textContent: p.builtin ? 'Copy and edit' : 'Edit' });
    edit.onclick = () => renderSetup(view, p.builtin ? { ...p, name: `${p.name} (copy)` } : p);
    const exp = el('button', { className: 'ghost', textContent: 'Export' });
    exp.onclick = async () => {
      const f = await api.profileExport(p.id);
      if (f) migSafeStatus(`Profile saved to ${f}`);
    };
    const bar = el('div', { className: 'toolbar' }, apply, edit, exp);
    if (!p.builtin) {
      const del = el('button', { className: 'ghost', textContent: 'Delete' });
      del.onclick = async () => {
        await api.profileDelete(p.id);
        renderSetup(view);
      };
      bar.append(del);
    }
    view.append(el('div', { className: 'card up' }, el('strong', { textContent: p.name }), ...(p.builtin ? [el('span', { className: 'tag', textContent: 'built in' })] : []), el('p', { className: 'lead', textContent: [p.description, ...parts].filter(Boolean).join(' ') }), bar));
  }
  syncButtons();
}

// ---------- Hardware Tests ----------

let hwStop = null;
function renderHardware(view) {
  if (hwStop) hwStop();
  hwStop = null;
  view.append(el('h1', { textContent: 'Hardware Tests' }), el('p', { className: 'lead', textContent: 'Hands-on checks for the parts a repair should prove: keyboard, screen, speakers, microphone, camera, ports and the processor under load.' }));
  const area = el('div', { className: 'hw-area' });
  const tests = [
    ['Keyboard', 'Press every key and watch it light up.', hwKeyboard],
    ['Screen', 'Full-screen colours for spotting dead pixels and backlight faults.', hwScreen],
    ['Speakers', 'Plays a tone through the left, then the right speaker.', hwSpeakers],
    ['Microphone', 'Shows a live level meter while you speak.', hwMic],
    ['Camera', 'Shows the live camera picture.', hwCamera],
    ['USB ports', 'Lists connected devices so you can test each port.', hwUsb],
    ['Processor stress test', 'Runs every core at full load and records the highest temperatures.', hwStress],
  ];
  const grid = el('div', { className: 'symptoms' });
  for (const [name, text, fn] of tests) {
    const b = el('button', { className: 'ghost symptom' }, el('strong', { textContent: name }), el('small', { textContent: text }));
    b.onclick = () => {
      if (hwStop) hwStop();
      hwStop = null;
      area.replaceChildren(el('h2', { textContent: name }));
      fn(area);
    };
    grid.append(b);
  }
  const drive = el('button', { className: 'ghost', textContent: 'Drive health and battery report' });
  drive.onclick = () => showPreview('health-report');
  view.append(grid, el('div', { className: 'toolbar' }, drive), area);
}

function hwKeyboard(area) {
  const rows = ['Escape F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 Delete', 'Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace', 'Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash', 'CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Enter', 'ShiftLeft KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight', 'ControlLeft MetaLeft AltLeft Space AltRight ControlRight ArrowLeft ArrowUp ArrowDown ArrowRight'];
  const label = (c) => c.replace(/^Key|^Digit/, '').replace('Arrow', '').replace('Left', ' L').replace('Right', ' R').replace('Backquote', '`').replace('Minus', '-').replace('Equal', '=').replace('Bracket L', '[').replace('Bracket R', ']').replace('Backslash', '\\').replace('Semicolon', ';').replace('Quote', "'").replace('Comma', ',').replace('Period', '.').replace('Slash', '/').replace('Escape', 'Esc').replace('Backspace', 'Bksp').replace('Control', 'Ctrl').replace('Meta', 'Win').replace('CapsLock', 'Caps');
  const keys = new Map();
  const board = el('div', { className: 'kb' });
  for (const r of rows) {
    const line = el('div', { className: 'kb-row' });
    for (const code of r.split(' ')) {
      const k = el('span', { className: 'key' + (code === 'Space' ? ' space' : ''), textContent: label(code) });
      keys.set(code, k);
      line.append(k);
    }
    board.append(line);
  }
  const info = el('p', { className: 'lead', textContent: 'Press each key once. Tested keys turn green. Keys not on this layout show in the list underneath.' });
  const extra = el('p', { className: 'lead' });
  const others = new Set();
  const count = () => (info.textContent = `${[...keys.values()].filter((k) => k.classList.contains('hit')).length} of ${keys.size} keys tested. Tested keys turn green.`);
  const down = (e) => {
    e.preventDefault();
    const k = keys.get(e.code);
    if (k) k.classList.add('hit');
    else {
      others.add(e.code);
      extra.textContent = `Other keys pressed: ${[...others].join(', ')}`;
    }
    count();
  };
  window.addEventListener('keydown', down, true);
  hwStop = () => window.removeEventListener('keydown', down, true);
  const reset = el('button', { className: 'ghost', textContent: 'Start again' });
  reset.onclick = () => {
    keys.forEach((k) => k.classList.remove('hit'));
    others.clear();
    extra.textContent = '';
    count();
  };
  area.append(info, board, extra, el('div', { className: 'toolbar' }, reset));
}

function hwScreen(area) {
  const colours = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#808080'];
  const go = el('button', { textContent: 'Start the screen test' });
  go.onclick = async () => {
    const full = el('div', { className: 'fullscreen-test' });
    let i = 0;
    let closed = false;
    // Closing never depends on full-screen mode having worked: the overlay is always removed.
    const close = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onChange);
      full.remove();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      if (hwStop === close) hwStop = null;
    };
    const next = () => {
      i++;
      if (i >= colours.length) close();
      else full.style.background = colours[i];
    };
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') close();
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') next();
    };
    const onChange = () => {
      if (!document.fullscreenElement) close();
    };
    full.style.background = colours[0];
    full.onclick = next;
    document.body.append(full);
    window.addEventListener('keydown', onKey, true);
    hwStop = close;
    try {
      await full.requestFullscreen();
      document.addEventListener('fullscreenchange', onChange);
    } catch {
      /* full screen was refused: the test still covers the whole window */
    }
  };
  area.append(el('p', { className: 'lead', textContent: 'The screen fills with red, green, blue, white, black and grey. Click (or press Space) to move to the next colour. After the last colour it closes by itself; Esc stops it at any time. Look for dots that stay dark or lit, and for uneven brightness on white and grey.' }), el('div', { className: 'toolbar' }, go));
}

function hwSpeakers(area) {
  const ctx = new AudioContext();
  hwStop = () => ctx.close();
  const tone = (pan) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const p = ctx.createStereoPanner();
    osc.frequency.value = 440;
    gain.gain.value = 0.25;
    p.pan.value = pan;
    osc.connect(gain).connect(p).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  };
  const mk = (text, pan) => {
    const b = el('button', { className: 'ghost', textContent: text });
    b.onclick = () => tone(pan);
    return b;
  };
  area.append(el('p', { className: 'lead', textContent: 'Each button plays a one-second tone. Left should come only from the left speaker and right only from the right. No sound at all points to the volume, the output device or the driver; run "No sound" from the Dashboard.' }), el('div', { className: 'toolbar' }, mk('Left speaker', -1), mk('Both speakers', 0), mk('Right speaker', 1)));
}

async function hwMic(area) {
  const msg = el('p', { className: 'lead', textContent: 'Asking for the microphone...' });
  const meter = el('div', { className: 'meter' }, el('div'));
  area.append(msg, meter);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.fftSize);
    let alive = true;
    hwStop = () => {
      alive = false;
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    };
    msg.textContent = `Speak into the microphone. The bar should move. Using: ${stream.getAudioTracks()[0].label || 'default microphone'}.`;
    const tick = () => {
      if (!alive) return;
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      meter.firstChild.style.width = `${Math.min(100, (peak / 128) * 160)}%`;
      requestAnimationFrame(tick);
    };
    tick();
  } catch {
    msg.textContent = 'No microphone could be opened. Check that one is connected and that microphone access is allowed in the system privacy settings.';
  }
}

async function hwCamera(area) {
  const msg = el('p', { className: 'lead', textContent: 'Asking for the camera...' });
  const video = el('video', { autoplay: true, muted: true, className: 'cam' });
  area.append(msg, video);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    hwStop = () => stream.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    msg.textContent = `You should see a live picture. Using: ${stream.getVideoTracks()[0].label || 'default camera'}.`;
  } catch {
    msg.textContent = 'No camera could be opened. Check for a privacy shutter or camera key, then run "Camera does not work" from the Dashboard.';
  }
}

async function hwUsb(area) {
  const msg = el('p', { className: 'lead', textContent: 'Reading connected devices...' });
  const list = el('ul', { className: 'guide' });
  const again = el('button', { className: 'ghost', textContent: 'Refresh' });
  area.append(msg, el('div', { className: 'toolbar' }, again), list);
  let before = null;
  const load = async () => {
    const now = await api.usbDevices();
    list.replaceChildren(...now.map((d) => el('li', { className: before && !before.includes(d) ? 'good' : '', textContent: d + (before && !before.includes(d) ? '  (new)' : '') })));
    const added = before ? now.filter((d) => !before.includes(d)).length : 0;
    msg.textContent = before ? (added ? `${added} new device${added === 1 ? '' : 's'} appeared, so that port works. Move the device to the next port and refresh again.` : 'Nothing new appeared. If you just plugged something in, that port or the device may be faulty.') : `${now.length} USB devices are connected. Plug a stick or mouse into one port, click Refresh, and it should appear as new. Repeat for each port.`;
    before = now;
  };
  again.onclick = load;
  load();
}

function hwStress(area) {
  const mins = el('select', { className: 'text' }, ...[2, 5, 10, 20, 30].map((m) => el('option', { value: m, textContent: `${m} minutes`, selected: m === 5 })));
  const go = el('button', { className: 'run', textContent: 'Start' });
  const stop = el('button', { className: 'ghost', textContent: 'Stop', hidden: true });
  const msg = el('p', { className: 'lead mig-status' });
  stop.onclick = () => api.stressStop();
  go.onclick = () => {
    stop.hidden = false;
    run(async () => {
      msg.textContent = 'Running every processor thread at full load...';
      const s = await api.stressStart(Number(mins.value));
      stop.hidden = true;
      showResults(s);
    }, api.stressStop);
  };
  area.append(el('p', { className: 'lead', textContent: 'Loads every processor thread and samples the temperature sensors every five seconds. A healthy computer finishes without freezing and stays under about 90 °C. Plug a laptop into power, and expect the fans to get loud. On Windows, open LibreHardwareMonitor first so temperatures can be read.' }), el('div', { className: 'toolbar' }, mins, go, stop), msg);
  syncButtons();
}

api.onStress((e) => {
  setProgress(e.total ? e.elapsed / e.total : 0);
  $('#runStatus').textContent = `Stress test: ${Math.floor(e.elapsed / 60)}:${String(e.elapsed % 60).padStart(2, '0')} of ${Math.floor(e.total / 60)}:00${e.sensors ? `, hottest sensor ${Math.round(e.hottest)} °C` : ', no temperature sensors'}`;
});
api.onShowSummary((s) => showResults(s));

async function renderTools(view) {
  const data = await api.tools();
  if (state.screen !== 'tools') return;
  const how = { winget: 'winget, straight from each publisher', brew: 'Homebrew', apt: 'apt', dnf: 'dnf', pacman: 'pacman', zypper: 'zypper' }[data.manager] || '';
  view.append(el('h1', { textContent: 'Tools' }), el('p', { className: 'lead', textContent: data.supported ? `Trusted repair tools, installed through ${how}.` : 'Trusted repair tools.' }));
  if (!data.supported) return view.append(el('div', { className: 'placeholder', textContent: state.info.platform === 'darwin' ? 'Tools on macOS are installed through Homebrew, which is not on this Mac yet. Install it from brew.sh, then reopen MendKit.' : 'No supported package manager (apt, dnf, pacman or zypper) was found on this computer.' }));
  const t = el('table', { className: 'searchable' });
  const allBox = el('input', { type: 'checkbox', title: 'Select all' });
  t.append(el('tr', {}, el('th', { className: 'chk' }, allBox), el('th', { textContent: 'Tool' }), el('th', { textContent: 'Job' }), el('th', { textContent: 'Status' }), el('th')));
  const rows = new Map();
  const many = el('button', { className: 'primary', textContent: 'Install selected' });
  const picked = () => [...rows.values()].filter((r) => r.box.checked && !r.box.disabled).map((r) => r.tool.id);
  const count = () => {
    const n = picked().length;
    many.textContent = n ? `Install ${n} selected` : 'Install selected';
  };
  const selAll = el('button', { className: 'ghost', textContent: 'Select all not installed' });
  const selNone = el('button', { className: 'ghost', textContent: 'Clear selection' });
  const setAll = (on) => {
    // Select all only ticks what the search is showing.
    for (const r of rows.values()) if (!r.box.disabled && (!on || !r.row.hidden)) r.box.checked = on;
    allBox.checked = on;
    count();
  };
  selAll.onclick = () => setAll(true);
  selNone.onclick = () => setAll(false);
  allBox.onchange = () => setAll(allBox.checked);
  many.onclick = async () => {
    const ids = picked();
    if (!ids.length) return migSafeStatus('Tick at least one tool to install.');
    await run(async () => showResults(await api.toolsInstallMany(ids)));
    state.toolStatus = null;
  };
  view.append(el('div', { className: 'toolbar' }, searchBar(view, 'Search tools by name or job'), selAll, selNone, many), noMatch());
  for (const tool of [...data.tools].sort((a, b) => a.job.localeCompare(b.job) || a.name.localeCompare(b.name))) {
    const name = el('td', {}, el('strong', { textContent: tool.name }), el('span', { className: 'tag', textContent: tool.license === 'open-source' ? 'open source' : 'free' }));
    if (tool.homeUseOnly) name.append(el('span', { className: 'tag', textContent: 'check licence for business use' }));
    name.append(el('br'), el('small', { textContent: tool.description }));
    const status = el('td', { textContent: 'Checking...' });
    const btn = el('button', { className: 'ghost run', textContent: 'Install', disabled: true });
    const box = el('input', { type: 'checkbox' });
    box.onchange = count;
    const guide = el('a', { className: 'link', textContent: 'How to use it' });
    guide.onclick = () => {
      state.guide = tool.id;
      show('guides');
    };
    name.append(' ', guide);
    const row = el('tr', { className: 'searchable' }, el('td', { className: 'chk' }, box), name, el('td', { textContent: tool.job }), status, el('td', { className: 'act' }, btn));
    rows.set(tool.id, { status, btn, tool, box, row });
    t.append(row);
  }
  view.append(t);
  const paint = (installed) => {
    for (const { status, btn, tool, box } of rows.values()) {
      const has = installed.includes(tool.id);
      box.disabled = has;
      if (has) box.checked = false;
      status.textContent = has ? 'Installed' : 'Not installed';
      status.className = has ? 'good' : '';
      btn.textContent = has ? 'Remove' : 'Install';
      btn.disabled = state.running;
      btn.onclick = async () => {
        await run(() => api.toolAction(tool.id, has ? 'remove' : 'install'));
        state.toolStatus = null;
        if (state.screen === 'tools') show('tools');
      };
    }
  };
  if (!state.toolStatus) state.toolStatus = await api.toolsStatus();
  paint(state.toolStatus);
}

function syncButtons() {
  document.querySelectorAll('button.run').forEach((b) => (b.disabled = state.running));
  $('#cancelBtn').hidden = !state.running;
}

async function run(start, cancel) {
  if (state.running) {
    // Say why nothing happened instead of ignoring the click.
    $('#runStatus').textContent = 'MendKit is still busy with another job. Wait for it to finish, or press Cancel in this panel, then try again.';
    $('#console').classList.add('flash');
    setTimeout(() => $('#console').classList.remove('flash'), 1200);
    return;
  }
  state.running = true;
  state.cancel = cancel || null;
  syncButtons();
  $('#output').textContent = '';
  outChars = 0;
  $('#stepList').replaceChildren();
  try {
    await start();
  } catch (err) {
    $('#runStatus').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  state.running = false;
  state.cancel = null;
  setTimeout(() => !state.running && setProgress(null), 1500);
  syncButtons();
}

/** Progress bar in the bottom panel. Pass a fraction from 0 to 1, or null to hide it. */
function setProgress(f) {
  $('#bar').hidden = f === null;
  $('#pct').textContent = f === null ? '' : `${Math.round(f * 100)}%`;
  if (f !== null) $('#barFill').style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
}
const prog = { weights: [], done: 0, cur: 0, started: 0, name: '', sawPercent: false, timer: null };
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
/** Shows the running step's elapsed time, and moves the bar by time for steps that print no percentage. */
function tick() {
  if (!state.running || !prog.started) return;
  const ms = Date.now() - prog.started;
  const usual = prog.weights[prog.cur] || 1;
  $('#runStatus').textContent = `Running step ${prog.cur + 1} of ${prog.weights.length}: ${prog.name} (${clock(ms)} so far, usually about ${usual} min)`;
  if (!prog.sawPercent) stepProgress(Math.min(0.9, ms / (usual * 60000)));
}
function stepProgress(frac) {
  const total = prog.weights.reduce((a, b) => a + b, 0) || 1;
  setProgress((prog.done + (prog.weights[prog.cur] || 0) * frac) / total);
}
const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(b ? 1 : 0, Math.round(b / 1024 ** 2))} MB`);

// ---------- Tweaks ----------

async function renderTweaks(view) {
  view.append(el('h1', { textContent: 'Tweaks' }), el('p', { className: 'lead', textContent: 'Tick what you want on, then Apply. MendKit remembers the old values so every change can be undone.' }));
  const data = await api.tweaks();
  if (state.screen !== 'tweaks') return;
  if (!data.supported) return view.append(el('div', { className: 'placeholder', textContent: 'Tweaks on Linux need the GNOME desktop (gsettings), which was not found on this computer.' }));
  const win = state.info.platform === 'win32';
  if (win && !state.info.elevated) view.append(adminNotice());
  const desired = { ...data.status };
  const boxes = new Map();
  const applyBtn = el('button', { className: 'primary' });
  const refresh = () => {
    const n = data.tweaks.filter((t) => desired[t.id] !== data.status[t.id]).length;
    applyBtn.textContent = n ? `Apply ${n} change${n === 1 ? '' : 's'}` : 'Apply changes';
    applyBtn.disabled = false;
    for (const [id, b] of boxes) b.checked = desired[id];
  };
  const bar = el('div', { className: 'toolbar' });
  for (const p of data.presets) {
    const b = el('button', { className: 'ghost', textContent: `${p.name} preset`, title: p.description });
    b.onclick = () => {
      for (const id of p.tweaks) desired[id] = true;
      refresh();
    };
    bar.append(b);
  }
  const imp = el('button', { className: 'ghost', textContent: 'Import' });
  imp.onclick = async () => {
    const ids = await api.tweaksImport().catch(() => null);
    if (!ids) return;
    for (const id of ids) desired[id] = true;
    refresh();
  };
  const exp = el('button', { className: 'ghost', textContent: 'Export ticked' });
  exp.onclick = async () => {
    const r = await api.tweaksExport(data.tweaks.filter((t) => desired[t.id]).map((t) => t.id));
    if (r) $('#runStatus').textContent = `Saved ${r.count} tweaks to ${r.file}`;
  };
  // Runs a tweak change, then shows what happened (applied, skipped for admin, failed) instead of
  // silently returning to the list, so it is always clear whether the change took effect.
  const runTweaks = (start, nothingMsg) =>
    run(async () => {
      const summary = await start();
      if (!summary) {
        migSafeStatus(nothingMsg);
        return;
      }
      showResults(summary);
    });
  const undo = el('button', { className: 'ghost run', textContent: `Undo all MendKit tweaks (${data.undoable.length})` });
  undo.disabled = !data.undoable.length;
  undo.onclick = () => runTweaks(() => api.tweaksUndoAll(), 'There were no MendKit tweaks to undo.');
  applyBtn.onclick = () => {
    if (!data.tweaks.some((t) => desired[t.id] !== data.status[t.id])) return migSafeStatus('Nothing to apply yet. Tick or untick a setting first; the button shows how many changes are waiting.');
    runTweaks(() => api.tweaksApply(desired), 'Nothing to apply - the settings already match what you ticked.');
  };
  bar.append(imp, exp, undo, applyBtn);
  view.append(bar);
  for (const group of [...new Set(data.tweaks.map((t) => t.group))]) {
    view.append(el('h2', { textContent: group }));
    const t = el('table');
    for (const tw of data.tweaks.filter((x) => x.group === group)) {
      const box = el('input', { type: 'checkbox' });
      box.onchange = () => {
        desired[tw.id] = box.checked;
        refresh();
      };
      boxes.set(tw.id, box);
      const name = el('td', {}, el('strong', { textContent: tw.name }));
      if (tw.admin) name.append(el('span', { className: 'tag', textContent: 'admin' }));
      if (tw.needsSignOut) name.append(el('span', { className: 'tag', textContent: 'shows after sign-out' }));
      if (data.undoable.includes(tw.id)) name.append(el('span', { className: 'tag', textContent: 'set by MendKit' }));
      name.append(el('br'), el('small', { textContent: tw.description }));
      t.append(el('tr', {}, el('td', { className: 'chk' }, box), name, el('td', { className: 'act ' + (data.status[tw.id] ? 'good' : ''), textContent: data.status[tw.id] ? 'On now' : 'Off now' })));
    }
    view.append(t);
  }
  if (win) {
    const rx = el('button', { className: 'ghost', textContent: 'Restart Explorer' });
    rx.onclick = () => api.restartExplorer();
    view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Some changes only show after you sign out or restart Explorer (the taskbar flashes for a moment).' }), rx));
  }
  refresh();
}

// ---------- Migrate ----------

const mig = { role: null, recv: null, peers: new Map(), paint: null, status: null };

function migSafeStatus(text) {
  $('#runStatus').textContent = text;
}
function migStatus(text) {
  $('#runStatus').textContent = text;
  if (mig.status && mig.status.isConnected) mig.status.textContent = text;
}

function renderMigrate(view) {
  view.append(el('h1', { textContent: 'Migrate' }), el('p', { className: 'lead', textContent: 'Move files, settings and an app list from an old computer to a new one, over your network or with an external drive.' }));
  if (!mig.role) {
    const pick = (role, title, text) => {
      const b = el('button', { className: 'big', textContent: title });
      b.onclick = () => {
        mig.role = role;
        show('migrate');
      };
      return el('div', { className: 'card choice' }, el('p', { className: 'lead', textContent: text }), b);
    };
    view.append(el('h2', { textContent: 'Over the network' }), el('div', { className: 'cards' },
      pick('send', 'Send from this computer', 'This is the OLD computer. Its files are copied to the new one. Nothing is deleted here.'),
      pick('receive', 'Receive on this computer', 'This is the NEW computer. Files arrive here. Nothing already here is overwritten.')));
    view.append(el('h2', { textContent: 'With an external drive' }), el('div', { className: 'cards' },
      pick('backup', 'Back up to a drive', 'Copies this computer\'s files, settings and app list to an external drive or USB stick.'),
      pick('restore', 'Restore from a drive', 'Copies a MendKit backup from a drive onto this computer. Nothing already here is overwritten.')));
    view.append(el('h2', { textContent: 'From a computer that will not start' }), el('div', { className: 'cards' },
      pick('olddrive', 'Copy from an old drive', 'Take the drive out of the old computer and connect it to this one (a USB adapter or dock works), or open a backup image of it. MendKit finds the people on it and copies their files and settings here.')));
    const planBox = el('div', { className: 'card up' });
    view.append(el('h2', { textContent: 'Keep a regular backup' }), planBox);
    paintBackupPlan(planBox);
    const pw = el('button', { className: 'ghost', textContent: 'Move saved passwords' });
    pw.onclick = () => {
      mig.role = 'passwords';
      show('migrate');
    };
    view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Saved passwords are not moved with the files above, because browsers lock them to each computer. MendKit can show you the safe way to move them yourself.' }), pw));
    return;
  }
  const back = el('button', { className: 'ghost', textContent: 'Start over' });
  back.onclick = async () => {
    await api.migStop();
    mig.role = null;
    mig.recv = null;
    mig.peers.clear();
    setProgress(null);
    show('migrate');
  };
  view.append(el('div', { className: 'toolbar' }, back));
  mig.status = el('p', { className: 'lead mig-status' });
  if (mig.role === 'receive') renderReceive(view);
  else if (mig.role === 'backup') renderBackup(view);
  else if (mig.role === 'restore') renderRestore(view);
  else if (mig.role === 'passwords') renderPasswords(view);
  else if (mig.role === 'olddrive') renderOldDrive(view);
  else renderSend(view);
}

async function renderReceive(view) {
  if (!mig.recv) {
    try {
      mig.recv = await api.migReceive();
    } catch (err) {
      return view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Could not start receiving: ' + (err.message || err) })));
    }
  }
  if (state.screen !== 'migrate' || mig.role !== 'receive') return;
  const r = mig.recv;
  const addr = r.addresses.map((a) => (r.port === 47601 ? a : `${a}:${r.port}`)).join('  or  ') || 'not connected to a network';
  view.append(
    el('div', { className: 'hero code-hero' },
      el('div', {}, el('strong', { textContent: 'Type this code on the old computer' }),
        el('p', { textContent: `On the old computer open MendKit, choose Migrate, then Send, pick "${r.name}" and type the code. If this computer is not listed there, type this address instead: ${addr}` })),
      el('div', { className: 'code', textContent: `${r.code.slice(0, 3)} ${r.code.slice(3)}` })),
    el('p', { className: 'lead note', textContent: 'If Windows asks, allow MendKit on private networks. Both computers must be on the same network.' }),
    mig.status);
  migStatus('Waiting for the old computer...');
}

function addAppsButton() {
  const b = el('button', { className: 'run', textContent: 'Reinstall apps from the old computer' });
  b.onclick = () => run(() => api.migInstallApps());
  $('.result-foot').prepend(b);
  syncButtons();
}

/** The "what to move" checklist shared by Send and Back up. */
function itemChecklist(view, scan, appsText) {
  const t = el('table');
  const checks = [];
  for (const it of scan.items) {
    const box = el('input', { type: 'checkbox', checked: true });
    checks.push({ id: it.id, box });
    t.append(el('tr', {}, el('td', { className: 'chk' }, box), el('td', {}, el('strong', { textContent: it.label })), el('td', { className: 'act', textContent: `${it.files.toLocaleString()} files, ${fmtSize(it.bytes)}` })));
  }
  const appsBox = el('input', { type: 'checkbox', checked: scan.canApps });
  if (scan.canApps) t.append(el('tr', {}, el('td', { className: 'chk' }, appsBox), el('td', {}, el('strong', { textContent: 'List of installed apps' }), el('br'), el('small', { textContent: appsText })), el('td')));
  view.append(t, el('p', { className: 'lead note', textContent: 'Saved passwords and sign-ins are not included. Use each browser\'s own sync or export for those. Close your programs first so their files can be read.' }));
  return { ids: () => checks.filter((c) => c.box.checked).map((c) => c.id), apps: () => scan.canApps && appsBox.checked, bytes: () => scan.items.filter((it) => checks.find((c) => c.id === it.id).box.checked).reduce((n, it) => n + it.bytes, 0) };
}

async function renderPasswords(view) {
  view.append(el('p', { className: 'lead', textContent: 'Each browser keeps your saved passwords encrypted with a key tied to this computer, so the files cannot simply be copied. The safe way is the browser\'s own sync or its password export. MendKit does not read your passwords; it just opens the right page for you.' }));
  const guides = await api.passwordGuides();
  if (state.screen !== 'migrate' || mig.role !== 'passwords') return;
  const installed = guides.filter((g) => g.installed);
  const list = installed.length ? installed : guides;
  if (!installed.length) view.append(el('p', { className: 'lead note', textContent: 'No supported browser was detected, so here is the guidance for all of them.' }));
  for (const g of list) {
    const box = el('div', { className: 'card pw' });
    box.append(el('strong', { textContent: g.name }));
    box.append(el('p', {}, el('span', { className: 'pw-tag', textContent: 'Best' }), ' ' + g.best));
    box.append(el('p', {}, el('span', { className: 'pw-tag', textContent: 'Or export' }), ' ' + g.export));
    if (g.installed) {
      const b = el('button', { className: 'ghost', textContent: `Open ${g.name}'s password page` });
      b.onclick = () => api.passwordOpen(g.id);
      box.append(b);
    }
    view.append(box);
  }
  view.append(el('p', { className: 'lead note', textContent: 'If you export to a file, treat it as sensitive: it holds your passwords in plain text. Import it on the new computer, then delete the file and empty the Recycle Bin or Trash.' }));
}

async function renderBackup(view) {
  view.append(el('p', { className: 'lead', textContent: 'Looking at what is on this computer...' }));
  const scan = await api.migScan();
  if (state.screen !== 'migrate' || mig.role !== 'backup') return;
  view.lastChild.remove();
  view.append(el('h2', { textContent: '1. What to back up' }));
  const list = itemChecklist(view, scan, 'Saved with the backup so a restore can reinstall the ones it can match, even on a different system.');
  view.append(el('h2', { textContent: '2. Where to save it' }));
  const where = el('p', { className: 'lead', textContent: 'No drive chosen yet.' });
  const go = el('button', { className: 'big run', textContent: 'Start backup', disabled: true });
  let picked = null;
  const choose = el('button', { className: 'ghost', textContent: 'Choose drive or folder' });
  choose.onclick = async () => {
    const r = await api.migPickBackup();
    if (!r) return;
    picked = r;
    const need = list.bytes();
    const tight = r.freeGb !== null && need / 1024 ** 3 > r.freeGb;
    where.textContent = `${r.dir}${r.freeGb !== null ? ` (${r.freeGb} GB free)` : ''}${r.exists ? '. A backup is already there; only new and changed files will be copied.' : ''}${tight ? ` Warning: you chose ${fmtSize(need)} and the drive may not have room.` : ''}`;
    where.className = 'lead' + (tight ? ' warn' : '');
    go.disabled = state.running;
  };
  go.onclick = () => {
    if (!picked) return;
    migStatus('Starting backup...');
    run(async () => {
      const summary = await api.migBackup(list.ids(), list.apps());
      setProgress(1);
      $('#runStatus').textContent = `${summary.title}: finished.`;
      showResults(summary);
    }, api.migCancel).then(() => mig.status && mig.status.isConnected && (mig.status.textContent = $('#runStatus').textContent));
  };
  view.append(el('div', { className: 'toolbar' }, choose), where,
    el('p', { className: 'lead note', textContent: 'The backup is a normal folder you can browse. It is not encrypted, so keep the drive somewhere safe.' }),
    el('div', { className: 'toolbar' }, go), mig.status);
}

function renderRestore(view) {
  const info = el('div');
  const choose = el('button', { textContent: 'Choose backup folder' });
  choose.onclick = async () => {
    let b;
    try {
      b = await api.migPickRestore();
    } catch (err) {
      return migStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
    if (!b) return;
    info.replaceChildren(el('p', { className: 'lead', textContent: `Backup of "${b.computer}" made ${new Date(b.createdAt).toLocaleString()}. Folder: ${b.dir}` }), el('h2', { textContent: '2. What to restore' }));
    const t = el('table');
    const checks = [];
    for (const it of b.items) {
      const box = el('input', { type: 'checkbox', checked: it.available, disabled: !it.available });
      checks.push({ id: it.id, box });
      t.append(el('tr', {}, el('td', { className: 'chk' }, box), el('td', {}, el('strong', { textContent: it.label }), ...(it.available ? [] : [el('br'), el('small', { textContent: 'Not available on this kind of computer' })])), el('td', { className: 'act', textContent: `${it.files.toLocaleString()} files, ${fmtSize(it.bytes)}` })));
    }
    const go = el('button', { className: 'big run', textContent: 'Start restore' });
    go.onclick = () => {
      migStatus('Starting restore...');
      run(async () => {
        const r = await api.migRestore(checks.filter((c) => c.box.checked).map((c) => c.id));
        setProgress(1);
        $('#runStatus').textContent = `${r.summary.title}: finished.`;
        showResults(r.summary);
        if (r.canInstallApps) addAppsButton();
      }, api.migCancel).then(() => mig.status && mig.status.isConnected && (mig.status.textContent = $('#runStatus').textContent));
    };
    info.append(t, el('p', { className: 'lead note', textContent: `Files already on this computer are not overwritten. A different file with the same name is kept alongside as "name (restored)".${b.hasApps ? ' The backup includes an app list you can reinstall afterwards.' : ''}` }), el('div', { className: 'toolbar' }, go));
    syncButtons();
  };
  view.append(el('h2', { textContent: '1. Where the backup is' }), el('div', { className: 'toolbar' }, choose), info, mig.status);
}

async function paintBackupPlan(box) {
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const p = await api.backupPlan();
  if (!box.isConnected) return;
  box.replaceChildren(el('strong', { textContent: 'Weekly backup to an external drive' }), el('p', { className: 'lead', textContent: `MendKit copies your files, settings and app list to the drive ${p.when}. Only new and changed files are copied. It stays silent unless the drive is missing or a file could not be copied.` }));
  const status = [];
  status.push(p.dir ? `Drive folder: ${p.dir}${p.connected ? '' : ' (not connected right now)'}` : 'No backup drive chosen yet.');
  if (p.lastRun) status.push(`Last backup: ${new Date(p.lastRun).toLocaleString()}${p.lastOk === false ? ', with problems' : ''}.`);
  box.append(el('p', { className: 'lead note', textContent: status.join(' ') }));
  const pick = el('button', { className: 'ghost', textContent: p.dir ? 'Change the drive' : 'Choose the backup drive' });
  pick.onclick = async () => {
    await api.backupPlanPick();
    paintBackupPlan(box);
  };
  const bar = el('div', { className: 'toolbar' }, pick);
  if (p.supported) {
    const toggle = el('button', { textContent: p.enabled ? 'Turn off the weekly backup' : 'Turn on the weekly backup', className: p.enabled ? 'ghost' : '' });
    toggle.onclick = async () => {
      try {
        await api.backupPlanSet(!p.enabled);
      } catch (err) {
        migSafeStatus(errText(err));
      }
      paintBackupPlan(box);
    };
    bar.append(toggle, el('span', { className: p.enabled ? 'good' : 'dim', textContent: p.enabled ? 'Scheduled' : 'Not scheduled' }));
  }
  const sys = el('button', { className: 'ghost', textContent: state.info.platform === 'win32' ? 'Open File History' : state.info.platform === 'darwin' ? 'Open Time Machine' : 'Open the system backup tool' });
  sys.onclick = async () => {
    const r = await api.backupOpenSystem();
    migSafeStatus(r.ok ? `${r.name} opened. Choose a drive there to let the system keep its own backups as well.` : r.name);
  };
  bar.append(sys);
  box.append(bar);
}

function renderOldDrive(view) {
  const info = el('div');
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const choose = el('button', { textContent: 'Choose the old drive' });
  choose.onclick = async () => {
    let d;
    try {
      d = await api.oldPick();
    } catch (err) {
      return migStatus(errText(err));
    }
    if (!d) return;
    const kinds = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    const who = el('select', { className: 'text' }, ...d.profiles.map((p, i) => el('option', { value: i, textContent: `${p.name} (${kinds[p.platform]})` })));
    const detail = el('div');
    const load = async () => {
      detail.replaceChildren(el('p', { className: 'lead', textContent: 'Looking at what is in that folder...' }));
      let scan;
      try {
        scan = await api.oldScan(Number(who.value));
      } catch (err) {
        return detail.replaceChildren(el('p', { className: 'lead', textContent: errText(err) }));
      }
      detail.replaceChildren(el('h2', { textContent: '3. What to copy' }));
      if (!scan.items.length) detail.append(el('p', { className: 'lead', textContent: 'No files could be read there. If the old drive came from a Windows computer, start MendKit as administrator and try again. A drive protected by BitLocker or FileVault has to be unlocked first.' }));
      const t = el('table');
      const checks = [];
      for (const it of scan.items) {
        const box = el('input', { type: 'checkbox', checked: it.available, disabled: !it.available });
        checks.push({ id: it.id, box });
        t.append(el('tr', {}, el('td', { className: 'chk' }, box), el('td', {}, el('strong', { textContent: it.label }), ...(it.available ? [] : [el('br'), el('small', { textContent: 'Not available on this kind of computer' })])), el('td', { className: 'act', textContent: `${it.files.toLocaleString()} files, ${fmtSize(it.bytes)}` })));
      }
      const appsBox = el('input', { type: 'checkbox', checked: scan.apps.length > 0 });
      if (scan.apps.length) t.append(el('tr', {}, el('td', { className: 'chk' }, appsBox), el('td', {}, el('strong', { textContent: 'App list' }), el('br'), el('small', { textContent: `Found on the old drive: ${scan.apps.join(', ')}. This computer can reinstall the ones it can match. It is a best guess from the old program folders.` })), el('td', { className: 'act', textContent: `${scan.apps.length} apps` })));
      const go = el('button', { className: 'big run', textContent: 'Start copying' });
      go.onclick = () => {
        migStatus('Starting...');
        run(async () => {
          const r = await api.oldImport(Number(who.value), checks.filter((c) => c.box.checked).map((c) => c.id), scan.apps.length > 0 && appsBox.checked);
          setProgress(1);
          $('#runStatus').textContent = `${r.summary.title}: finished.`;
          showResults(r.summary);
          if (r.canInstallApps) addAppsButton();
        }, api.migCancel).then(() => mig.status && mig.status.isConnected && (mig.status.textContent = $('#runStatus').textContent));
      };
      detail.append(t, el('p', { className: 'lead note', textContent: 'Nothing on the old drive is changed. Files already on this computer are not overwritten; a different file with the same name is kept alongside as "name (restored)". Saved passwords and cookies are not copied.' }), el('div', { className: 'toolbar' }, go));
      syncButtons();
    };
    who.onchange = load;
    info.replaceChildren(el('p', { className: 'lead', textContent: `Folder: ${d.dir}` }), el('h2', { textContent: '2. Whose files' }), el('div', { className: 'toolbar' }, who), detail);
    load();
  };
  view.append(el('h2', { textContent: '1. Where the old drive is' }), el('p', { className: 'lead', textContent: 'Choose the drive itself, the Users (or home) folder on it, or one person\'s folder. A drive that clicks, disappears or reads very slowly is failing: copy the most important folders first.' }), el('div', { className: 'toolbar' }, choose), info, mig.status);
}

// ---------- Crash Analyzer ----------

async function renderCrash(view) {
  view.append(el('h1', { textContent: 'Crash Analyzer' }), el('p', { className: 'lead', textContent: 'Reading the crash records from the last 30 days...' }));
  let a;
  try {
    a = await api.crashScan();
  } catch (err) {
    if (state.screen === 'crash') view.lastChild.textContent = 'The crash records could not be read.';
    return;
  }
  if (state.screen !== 'crash') return;
  view.lastChild.remove();
  view.append(el('div', { className: 'result-head ' + a.overall }, el('div', { className: 'icon big ' + a.overall, textContent: ICONS[a.overall] }), el('div', {}, el('h1', { textContent: a.headline }), el('p', { className: 'lead', textContent: a.summary }))));
  if (state.info.platform === 'win32' && !a.elevated) view.append(el('div', { className: 'notice' }, el('span', { textContent: 'Some crash records can only be read as administrator. Restart MendKit as administrator for the full picture.' })));
  const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  if (a.findings.length) {
    view.append(el('h2', { textContent: 'What was found' }));
    const list = el('div', { className: 'results' });
    for (const f of a.findings) list.append(el('div', { className: 'result ' + f.level }, el('div', { className: 'icon ' + f.level, textContent: ICONS[f.level] }), el('div', {}, el('strong', { textContent: `${f.title}${f.count > 1 ? `, ${f.count} times` : ''}` }), el('p', { textContent: f.explanation }), el('small', { textContent: `Most recent: ${when(f.last)}` }))));
    view.append(list);
  }
  if (a.advice.length) {
    view.append(el('h2', { textContent: 'What to do, in order' }));
    const list = el('div', { className: 'results' });
    a.advice.forEach((ad, i) => {
      const row = el('div', { className: 'result advice' }, el('div', { className: 'icon info', textContent: String(i + 1) }), el('div', { className: 'grow' }, el('p', { className: 'plain', textContent: ad.text })));
      if (ad.action) {
        const b = el('button', { className: 'ghost', textContent: ad.action.label });
        b.onclick = async () => {
          if (ad.action.type === 'recipe') showPreview(ad.action.id);
          else if (ad.action.type === 'memtest') {
            await api.crashMemtest();
            migSafeStatus('Windows Memory Diagnostic opened. Choose "Restart now and check for problems". The result shows after Windows starts again.');
          } else show(SCREENS.find((x) => x.id === ad.action.id && (state.mode === 'technician' || x.simple)) ? ad.action.id : 'dashboard');
        };
        row.append(b);
      }
      list.append(row);
    });
    view.append(list);
  }
  if (a.events.length) {
    view.append(el('h2', { textContent: `Timeline (${a.events.length})` }));
    const t = el('table');
    const rows = a.events.map((e) => el('tr', {}, el('td', { textContent: when(e.time) }), el('td', {}, el('strong', { textContent: e.title }), ...(state.mode === 'technician' && e.detail ? [el('br'), el('small', { textContent: e.detail })] : []))));
    rows.slice(0, 15).forEach((r) => t.append(r));
    view.append(t);
    if (rows.length > 15) {
      const more = el('button', { className: 'ghost', textContent: `Show all ${rows.length}` });
      more.onclick = () => {
        rows.slice(15).forEach((r) => t.append(r));
        more.remove();
      };
      view.append(el('div', { className: 'toolbar' }, more));
    }
  }
  const again = el('button', { className: 'ghost', textContent: 'Scan again' });
  again.onclick = () => show('crash');
  view.append(el('div', { className: 'result-foot' }, again));
}

// ---------- Backup image and secure erase ----------

async function renderDrive(view) {
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  view.append(el('h1', { textContent: 'Backup & Erase' }), el('p', { className: 'lead', textContent: 'Make a full backup image before a risky repair, and erase files or drives so they cannot be recovered.' }));
  const [img, free, drives] = await Promise.all([api.imageInfo(), api.wipeFreeTargets(), api.wipeDrives()]);
  if (state.screen !== 'drive') return;

  // Backup image
  const ib = el('div', { className: 'card up' }, el('strong', { textContent: `Backup image before repair (${img.method})` }), el('p', { className: 'lead', textContent: img.note }));
  if (img.supported) {
    const usable = img.targets.filter((t) => t.ok);
    const sel = el('select', { className: 'text' }, ...img.targets.map((t) => el('option', { value: t.id, textContent: t.ok ? t.label : `${t.label} - ${t.why}`, disabled: !t.ok, selected: usable[0] && usable[0].id === t.id })));
    const go = el('button', { className: 'run', textContent: 'Create the backup image' });
    go.onclick = () => run(async () => showResults(await api.imageStart(sel.value)));
    if (usable.length) ib.append(el('div', { className: 'toolbar' }, sel, go));
    else ib.append(el('p', { className: 'lead note', textContent: img.targets.length ? 'None of the connected drives can hold the image. Connect an NTFS drive with enough free space.' : 'Connect an external drive with enough free space, then open this screen again.' }));
    if (img.usedBytes) ib.append(el('p', { className: 'lead note', textContent: `The image needs about ${fmtSize(img.usedBytes)}. To put it back, start Windows recovery (hold Shift while choosing Restart), then Troubleshoot, Advanced options, System Image Recovery.` }));
  }
  view.append(ib, el('h2', { textContent: 'Secure erase' }), el('div', { className: 'notice' }, el('span', { textContent: 'Erasing cannot be undone. On solid-state drives (SSD, NVMe, USB sticks) old copies can survive an overwrite; for those, erase the whole drive or use the maker\'s secure erase.' })));

  const confirmBox = () => el('input', { type: 'text', className: 'text confirm', placeholder: 'Type ERASE to confirm' });

  // Files and folders
  const fb = el('div', { className: 'card up' }, el('strong', { textContent: 'Erase chosen files and folders' }), el('p', { className: 'lead', textContent: 'Overwrites each file with random data, then deletes it. Use it for documents that must not be recoverable.' }));
  const flist = el('ul', { className: 'guide' });
  const fconfirm = confirmBox();
  const fgo = el('button', { className: 'run danger', textContent: 'Erase them' });
  let ready = false;
  const paint = (items) => {
    ready = items.some((i) => !i.blocked);
    flist.replaceChildren(...items.map((i) => el('li', { className: i.blocked ? 'dim' : '', textContent: i.blocked ? `${i.path} - protected, will not be erased` : `${i.path} (${i.files.toLocaleString()} file${i.files === 1 ? '' : 's'}, ${fmtSize(i.bytes)})` })));
  };
  const mkPick = (text, kind) => {
    const b = el('button', { className: 'ghost', textContent: text });
    b.onclick = async () => paint(await api.wipePick(kind));
    return b;
  };
  const clear = el('button', { className: 'ghost', textContent: 'Clear the list' });
  clear.onclick = async () => paint(await api.wipeClear());
  fgo.onclick = () => {
    if (!ready) return migSafeStatus('Add files or a folder to erase first.');
    if (fconfirm.value.trim() !== 'ERASE') return migSafeStatus('Type ERASE in the box to confirm. Erased files cannot be brought back.');
    run(async () => showResults(await api.wipeFilesStart('ERASE')), api.wipeCancel);
  };
  fb.append(el('div', { className: 'toolbar' }, mkPick('Add files', 'files'), mkPick('Add a folder', 'folder'), clear), flist, el('div', { className: 'toolbar' }, fconfirm, fgo));
  view.append(fb);
  paint(await api.wipeClear());

  // Free space
  const sb = el('div', { className: 'card up' }, el('strong', { textContent: 'Erase free space' }), el('p', { className: 'lead', textContent: 'Overwrites the empty part of a drive, so files deleted earlier cannot be recovered. Nothing that is still on the drive is touched. It can take hours on a large drive.' }));
  const ssel = el('select', { className: 'text' }, ...free.map((t) => el('option', { value: t.id, textContent: t.label })));
  const sgo = el('button', { className: 'run', textContent: 'Erase free space' });
  sgo.onclick = () => run(async () => showResults(await api.wipeFreeStart(ssel.value)), api.wipeCancel);
  sb.append(el('div', { className: 'toolbar' }, ssel, sgo));
  view.append(sb);

  // Whole drive
  const db = el('div', { className: 'card up' }, el('strong', { textContent: 'Erase a whole drive' }), el('p', { className: 'lead', textContent: 'Overwrites every part of an external or second drive with zeros. Everything on it is destroyed. The drive this computer runs from is never listed.' }));
  if (drives.length) {
    const dsel = el('select', { className: 'text' }, ...drives.map((d) => el('option', { value: d.id, textContent: `${d.name}, ${d.size} (${d.detail})` })));
    const dconfirm = confirmBox();
    const dgo = el('button', { className: 'run danger', textContent: 'Erase the drive' });
    dgo.onclick = () => {
      if (dconfirm.value.trim() !== 'ERASE') return migSafeStatus('Type ERASE in the box to confirm. Everything on the chosen drive will be destroyed.');
      run(async () => showResults(await api.wipeDriveStart(dsel.value, 'ERASE')), api.wipeCancel);
    };
    db.append(el('div', { className: 'toolbar' }, dsel), el('div', { className: 'toolbar' }, dconfirm, dgo));
    if (state.info.platform === 'win32' && !state.info.elevated) db.append(el('p', { className: 'lead note', textContent: 'Erasing a drive needs administrator rights. Use "Restart as administrator" on the Dashboard first.' }));
  } else db.append(el('p', { className: 'lead note', textContent: 'No drive that can be erased is connected. Connect the external drive, then open this screen again.' }));
  view.append(db);

  // Whole computer
  const wb = el('div', { className: 'card up' }, el('strong', { textContent: 'Erase this whole computer (before selling or recycling)' }));
  const iso = el('button', { className: 'ghost', textContent: 'Open the ISO Library' });
  iso.onclick = () => show('isos');
  if (state.info.platform === 'win32') {
    const reset = el('button', { className: 'ghost', textContent: 'Open Reset this PC' });
    reset.onclick = () => api.wipeOpenReset();
    wb.append(el('p', { className: 'lead', textContent: 'MendKit cannot erase the drive it is running from. Use Windows Reset: choose "Remove everything", then "Change settings" and turn on "Clean data". For a drive that will leave your hands without Windows, boot ShredOS from the ISO Library instead.' }), el('div', { className: 'toolbar' }, reset, iso));
  } else if (state.info.platform === 'darwin') {
    wb.append(el('p', { className: 'lead', textContent: 'MendKit cannot erase the drive it is running from. On a Mac from 2018 or later, open System Settings, General, Transfer or Reset, then "Erase All Content and Settings". On older Macs, start in Recovery (Command-R) and erase the drive in Disk Utility.' }));
  } else {
    wb.append(el('p', { className: 'lead', textContent: 'MendKit cannot erase the drive it is running from. Write ShredOS from the ISO Library to a USB stick, start the computer from it and erase the drives there.' }), el('div', { className: 'toolbar' }, iso));
  }
  view.append(wb);
  syncButtons();
}

async function renderSend(view) {
  view.append(el('p', { className: 'lead', textContent: 'Looking at what is on this computer...' }));
  mig.peers.clear();
  await api.migFind();
  const scan = await api.migScan();
  if (state.screen !== 'migrate' || mig.role !== 'send') return;
  view.lastChild.remove();

  view.append(el('h2', { textContent: '1. What to move' }));
  const list = itemChecklist(view, scan, 'The new computer reinstalls the ones it can match, even on a different system. Programs are not copied directly.');

  view.append(el('h2', { textContent: '2. The new computer' }));
  const peerBox = el('div', { className: 'peers' });
  const manual = el('input', { type: 'text', placeholder: 'or type its address, like 192.168.1.20', className: 'text' });
  let chosen = null;
  mig.paint = () => {
    peerBox.replaceChildren();
    if (!mig.peers.size) peerBox.append(el('p', { className: 'lead', textContent: 'Searching the network... Open Migrate, then Receive, on the new computer.' }));
    for (const p of mig.peers.values()) {
      const b = el('button', { className: chosen === p.host ? '' : 'ghost', textContent: `${p.name} (${p.host})` });
      b.onclick = () => {
        chosen = p.host;
        manual.value = '';
        mig.paint();
      };
      peerBox.append(b);
    }
  };
  mig.paint();
  view.append(peerBox, manual);

  view.append(el('h2', { textContent: '3. The code shown on the new computer' }));
  const code = el('input', { type: 'text', placeholder: '6 digits', className: 'text code-in', maxLength: 7, inputMode: 'numeric' });
  const go = el('button', { className: 'big run', textContent: 'Start moving' });
  go.onclick = () => {
    let host = manual.value.trim() || chosen;
    let port = 47601;
    if (host && manual.value.trim() && host.includes(':')) [host, port] = [host.split(':')[0], Number(host.split(':')[1])];
    else if (host && mig.peers.has(host)) port = mig.peers.get(host).port;
    const digits = code.value.replace(/\D/g, '');
    if (!host) return migStatus('Choose the new computer or type its address.');
    if (digits.length !== 6) return migStatus('Type the six-digit code shown on the new computer.');
    const ids = list.ids();
    migStatus('Connecting...');
    run(async () => {
      const summary = await api.migSend(host, port, digits, ids, list.apps());
      setProgress(1);
      $('#runStatus').textContent = `${summary.title}: finished.`;
      showResults(summary);
    }, api.migCancel).then(() => mig.status && mig.status.isConnected && (mig.status.textContent = $('#runStatus').textContent));
  };
  view.append(el('div', { className: 'toolbar' }, code, go), mig.status);
  syncButtons();
}

api.onMigrate((e) => {
  if (e.phase === 'peer') {
    mig.peers.set(e.host, e);
    if (mig.paint && mig.role === 'send') mig.paint();
  } else if (e.phase === 'paired') migStatus(`Connected to ${e.peer}. Getting ready...`);
  else if (e.phase === 'manifest') migStatus(`${e.totalFiles.toLocaleString()} files, ${fmtSize(e.totalBytes)} to check and copy.`);
  else if (e.phase === 'progress') {
    setProgress(e.totalBytes ? e.bytesDone / e.totalBytes : e.totalFiles ? e.filesDone / e.totalFiles : 1);
    migStatus(`${fmtSize(e.bytesDone)} of ${fmtSize(e.totalBytes)}, ${e.filesDone.toLocaleString()} of ${e.totalFiles.toLocaleString()} files${e.current ? ` - ${e.current}` : ''}`);
  } else if (e.phase === 'error') migStatus(e.message);
  else if (e.phase === 'locked') migStatus('Too many wrong codes. Choose Start over to get a new code.');
  else if (e.phase === 'done') {
    setProgress(1);
    migStatus('Finished.');
    if (state.screen !== 'migrate') state.screen = 'migrate';
    renderNav();
    showResults(e.summary);
    if (e.canInstallApps) addAppsButton();
  }
});

const outBuf = [];
let outPending = false;
let outChars = 0;
function flushOutput() {
  outPending = false;
  const out = $('#output');
  const text = outBuf.join('');
  outBuf.length = 0;
  if (!text) return;
  const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
  // Tools that redraw one progress line send it with carriage returns; keep only the last version of each line.
  const clean = text.replace(/[^\n\r]*\r(?!\n)/g, '');
  out.append(clean);
  outChars += clean.length;
  // Keep the panel light on long runs: drop the oldest chunks (the full text is always in the log file).
  while (outChars > 300000 && out.childNodes.length > 1) {
    outChars -= out.firstChild.textContent.length;
    out.firstChild.remove();
  }
  if (stick) out.scrollTop = out.scrollHeight;
}

api.onEvent((e) => {
  const out = $('#output');
  const steps = $('#stepList');
  if (e.type === 'run-start') {
    prog.weights = e.steps.map((s) => s.minutes || 1);
    prog.done = 0;
    prog.cur = 0;
    setProgress(0);
    $('#runStatus').textContent = `Running: ${e.title}`;
    steps.replaceChildren(...e.steps.map((s) => el('li', { textContent: s.name })));
  } else if (e.type === 'step-start') {
    steps.children[e.index].className = 'running';
    prog.cur = e.index;
    prog.started = Date.now();
    prog.name = e.name;
    prog.sawPercent = false;
    clearInterval(prog.timer);
    prog.timer = setInterval(tick, 1000);
    stepProgress(0);
    $('#runStatus').textContent = `Running step ${e.index + 1} of ${steps.children.length}: ${e.name}`;
  } else if (e.type === 'step-end') {
    steps.children[e.index].className = e.result.status;
    clearInterval(prog.timer);
    prog.started = 0;
    prog.done += prog.weights[e.index] || 0;
    prog.cur = e.index + 1;
    stepProgress(0);
    if (e.result.note) steps.children[e.index].title = e.result.note;
  } else if (e.type === 'output') {
    // Tools like DISM, SFC and CHKDSK print their own percentage; use the latest one for this step.
    const pcts = e.text.match(/\d{1,3}(?:\.\d+)?\s?(?:%|percent)/g);
    if (pcts) {
      const v = parseFloat(pcts[pcts.length - 1]);
      if (v >= 0 && v <= 100) {
        prog.sawPercent = true;
        stepProgress(v / 100);
      }
    }
    // Output can arrive hundreds of times a second; it is collected and drawn once per frame.
    outBuf.push(e.text);
    if (!outPending) {
      outPending = true;
      requestAnimationFrame(flushOutput);
    }
  } else if (e.type === 'run-end') {
    const s = e.summary;
    const ok = s.steps.filter((x) => x.status === 'ok').length;
    const skipped = s.steps.filter((x) => x.status === 'needs-admin').length;
    let msg = `${s.title}: ${s.outcome}. ${ok} of ${s.steps.length} steps OK.`;
    if (skipped) msg += ` ${skipped} skipped (need administrator).`;
    if (s.stopReason) msg += ` Stopped at ${s.stopReason}.`;
    if (s.needsRestart) msg += ' Restart the computer to finish.';
    setProgress(1);
    $('#runStatus').textContent = msg;
    if (state.mode === 'simple' && s.kind !== 'tool') showResults(s);
  }
});

$('#cancelBtn').onclick = () => (state.cancel || api.cancel)();
$('#techToggle').onchange = async (ev) => {
  state.mode = (await api.setMode(ev.target.checked ? 'technician' : 'simple')).mode;
  show(state.screen);
};

(async function init() {
  api.appVersion().then((v) => ($('#version').textContent = `MendKit ${v}`));
  [state.info, state.catalog, state.mode, state.symptoms] = await Promise.all([api.systemInfo(), api.catalog(), api.settings().then((s) => s.mode), api.symptoms()]);
  const checkOnline = async () => {
    const on = await api.online();
    const changed = state.online !== on && (state.online !== undefined || !on);
    state.online = on;
    $('#netBadge').hidden = on;
    if (changed && !state.running && ['tools', 'updates', 'isos'].includes(state.screen)) show(state.screen);
  };
  $('#updateBadge').onclick = () => !state.running && show('updates');
  checkOnline(); // not awaited: with no network this can take seconds, and the first screen should not wait for it
  setInterval(checkOnline, 60000);
  show('dashboard');
})();
