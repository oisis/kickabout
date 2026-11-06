// Account page: sign in with a provider, then manage name, linked providers, sessions and deletion.
import { t, lang, api, setHeader } from './site.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const NAMES = { google: 'Google', github: 'GitHub', dev: 'Dev' };
const date = (ms) => new Date(ms).toLocaleDateString(lang);

function notice(text, ok = false) {
  const n = $('#notice');
  n.textContent = text; n.className = ok ? 'notice ok' : 'notice'; n.hidden = !text;
}

const params = new URLSearchParams(location.search);
if (params.get('error')) notice(t(`err_${params.get('error')}`) === `err_${params.get('error')}` ? t('err_generic') : t(`err_${params.get('error')}`));
if (params.get('linked')) notice(t('linked_ok'), true);
if (params.size) history.replaceState(null, '', location.pathname);

async function signedOut() {
  $('#me').hidden = true; $('#signin').hidden = false;
  const { data } = await api('/config');
  const box = $('#providers');
  box.replaceChildren(...(data.providers ?? []).map((p) => el('a', { className: 'btn', href: `/api/auth/${p}`, textContent: t(`with_${p}`) })));
  if (data.devLogin) {
    const name = el('input', { type: 'text', placeholder: t('dev_name'), required: true, maxLength: 40 });
    const form = el('form', { className: 'inline' }, name, el('button', { className: 'btn ghost', textContent: t('with_dev') }));
    form.onsubmit = async (e) => { e.preventDefault(); if ((await api('/auth/dev', { method: 'POST', body: JSON.stringify({ name: name.value }) })).status === 200) location.reload(); };
    box.append(form);
  }
  if (!box.children.length) box.append(el('p', { className: 'muted', textContent: t('no_providers') }));
}

function show(me) {
  $('#signin').hidden = true; $('#me').hidden = false;
  $('#avatar').src = me.avatar || '/play/icon.svg';
  $('#name').textContent = me.name;
  setHeader(me);
  $('#email').textContent = me.email;
  $('#name-input').value = me.name;
  const linked = new Set(me.identities.map((i) => i.provider));
  $('#identities').replaceChildren(
    ...me.identities.map((i) => {
      const b = el('button', { className: 'btn ghost', textContent: t('unlink'), disabled: me.identities.length < 2 });
      b.onclick = () => act(`/me/identities/${i.provider}`, 'DELETE');
      return el('li', {}, el('strong', { textContent: NAMES[i.provider] ?? i.provider }), el('span', { className: 'grow muted', textContent: i.email }), b);
    }),
    ...me.providers.filter((p) => !linked.has(p)).map((p) =>
      el('li', {}, el('strong', { textContent: NAMES[p] }), el('span', { className: 'grow' }), el('a', { className: 'btn', href: `/api/auth/${p}?link=1`, textContent: t('link') }))),
  );
  $('#sessions').replaceChildren(...me.sessions.map((s) => el('li', {},
    el('span', { className: 'grow', textContent: s.agent.replace(/^Mozilla\/5\.0 /, '') || '—', title: s.agent }),
    el('span', { className: 'muted', textContent: `${t('since')} ${date(s.created)}` }),
    s.current ? el('span', { className: 'tag', textContent: t('this_device') }) : '')));
  $('#logout-others').hidden = me.sessions.length < 2;
}

async function act(path, method, body) {
  const r = await api(path, { method, body: body && JSON.stringify(body) });
  if (r.status === 200 && r.data.id) show(r.data);
  else if (r.status !== 200) notice(t('err_generic'));
  return r;
}

$('#rename').onsubmit = async (e) => { e.preventDefault(); if ((await act('/me', 'PATCH', { name: $('#name-input').value.trim() })).status === 200) notice(t('saved'), true); };
$('#logout-others').onclick = () => act('/logout-others', 'POST');
$('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.href = '/'; };
$('#delete').onclick = async () => { if (confirm(t('confirm_delete')) && (await api('/me', { method: 'DELETE' })).status === 200) location.href = '/'; };

const { status, data } = await api('/me').catch(() => ({ status: 0 }));
if (status === 200) show(data); else signedOut();
