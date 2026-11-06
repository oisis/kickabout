// Administration: who is online, accounts and their e-mails, adding, blocking and deleting users.
// The API answers only administrators (ADMIN_EMAILS on the server); this page just shows it.
import { t, lang, api } from './site.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const date = (ms) => (ms ? new Date(ms).toLocaleDateString(lang) : '—');
const NAMES = { google: 'Google', github: 'GitHub', dev: 'Dev' };
let me = null;

function notice(text, ok = false) {
  const n = $('#notice');
  n.textContent = text; n.className = ok ? 'notice ok' : 'notice'; n.hidden = !text;
}

async function stats() {
  const { status, data: s } = await api('/admin/stats');
  if (status !== 200) return;
  const box = (big, label) => el('div', { className: 'card' }, el('div', { className: 'big', textContent: big.toLocaleString(lang) }), el('div', { className: 'muted', textContent: label }));
  $('#stats').replaceChildren(
    box(s.online, `${t('adm_online')} — ${s.playing} ${t('adm_playing')}, ${s.waiting} ${t('adm_waiting')}, ${s.watching} ${t('adm_watching')}`),
    box(s.matches, t('adm_matches')), box(s.users, t('adm_users_n')), box(s.clubs, t('adm_clubs')), box(s.banned, t('adm_banned_n')));
}

function row(u) {
  const tags = [
    u.admin && el('span', { className: 'tag', textContent: t('adm_admin') }),
    u.banned && el('span', { className: 'tag red', textContent: t('adm_banned') }),
    !u.identities.length && el('span', { className: 'tag grey', textContent: t('adm_invited') }),
  ].filter(Boolean);
  const emails = [...new Set([u.email, ...u.identities.map((i) => i.email)].filter(Boolean))].join(', ');
  const via = u.identities.map((i) => NAMES[i.provider] ?? i.provider).join(', ');
  const info = [via, u.club && `⚽ ${u.club}`, `${u.coins.toLocaleString(lang)} 🪙`, `${t('adm_joined')} ${date(u.created)}`, u.seen && `${t('adm_seen')} ${date(u.seen)}`].filter(Boolean).join(' • ');
  const self = u.id === me.id;
  const ban = el('button', { className: 'btn ghost', textContent: u.banned ? t('adm_unban') : t('adm_ban'), disabled: self });
  ban.onclick = async () => {
    if (!u.banned && !confirm(t('adm_confirm_ban').replace('{0}', u.name))) return;
    if ((await api(`/admin/users/${u.id}/ban`, { method: 'POST', body: JSON.stringify({ banned: !u.banned }) })).status === 200) refresh();
    else notice(t('err_generic'));
  };
  const del = el('button', { className: 'btn danger', textContent: t('adm_delete'), disabled: self });
  del.onclick = async () => {
    if (!confirm(t('adm_confirm_delete').replace('{0}', u.name))) return;
    if ((await api(`/admin/users/${u.id}`, { method: 'DELETE' })).status === 200) refresh();
    else notice(t('err_generic'));
  };
  return el('li', { className: u.banned ? 'banned' : '' },
    el('img', { src: u.avatar || '/play/icon.svg', alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
    el('div', { className: 'who' }, el('strong', { textContent: `${u.name} ` }), ...tags, el('small', { textContent: emails || '—' }), el('small', { textContent: info })),
    el('div', { className: 'acts' }, ban, del));
}

async function users() {
  const { status, data } = await api(`/admin/users?q=${encodeURIComponent($('#q').value.trim())}`);
  if (status !== 200) return;
  $('#users').replaceChildren(...(data.length ? data.map(row) : [el('li', { className: 'muted', textContent: t('adm_none') })]));
}

async function emails() {
  const { status, data } = await api('/admin/emails');
  if (status === 200) $('#emails').textContent = data.map((e) => e.email).join('\n');
}

const refresh = () => Promise.all([stats(), users(), emails()]);

let timer = 0;
$('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(users, 250); };
$('#search').onsubmit = (e) => { e.preventDefault(); users(); };
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText($('#emails').textContent); notice(t('adm_copied'), true); } catch { notice(t('err_generic')); } };
$('#add').onsubmit = async (e) => {
  e.preventDefault();
  const r = await api('/admin/users', { method: 'POST', body: JSON.stringify({ name: $('#add-name').value.trim(), email: $('#add-email').value.trim() }) });
  if (r.status === 200) { notice(t('adm_added'), true); e.target.reset(); refresh(); }
  else notice(t(r.status === 409 ? 'adm_exists' : r.status === 400 ? 'adm_bad' : 'err_generic'));
};

const r = await api('/me').catch(() => ({ status: 0 }));
if (r.status === 200 && r.data.admin) {
  me = r.data;
  $('#panel').hidden = false;
  refresh();
  setInterval(() => { if (!document.hidden) stats(); }, 15_000);
} else if (r.status === 200) $('#denied').hidden = false;
else location.href = '/account.html';
