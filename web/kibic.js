// Fan zone: live online matches; the chosen one plays in the browser game's watch mode.
import { t, API } from './site.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
let current = location.hash.slice(1);

function watch(id) {
  current = id;
  history.replaceState(null, '', `#${id}`); // a link to share
  $('#player').src = `/play/?watch=${encodeURIComponent(id)}`;
  $('#player').hidden = false;
  $('#placeholder').hidden = true;
  for (const li of document.querySelectorAll('#matches li')) li.classList.toggle('on', li.dataset.id === id);
}

function card(m) {
  const team = (x) => el('span', { className: 'team' }, el('i', { className: 'shirt', style: `background:${x.shirt}` }), x.name);
  const min = m.phase === 'end' ? t('live_end') : m.phase === 'half' ? t('live_half') : `${m.minute}'`;
  const li = el('li', { className: m.id === current ? 'on' : '' },
    el('div', { className: 'teams' }, team(m.home), team(m.away)),
    el('div', { className: 'score' }, `${m.score[0]}:${m.score[1]}`),
    el('div', { className: 'meta' }, el('span', { className: 'tag live' }, `● ${min}`), el('span', { className: 'muted' }, t(`kind_${m.kind}`)), el('span', { className: 'muted' }, `👁 ${m.spectators}`)));
  li.dataset.id = m.id;
  li.tabIndex = 0;
  li.onclick = () => watch(m.id);
  li.onkeydown = (e) => { if (e.key === 'Enter') watch(m.id); };
  return li;
}

async function refresh() {
  const list = await fetch(`${API}/live`).then((r) => r.json()).catch(() => null);
  if (!list) return;
  $('#matches').replaceChildren(...list.map(card));
  $('#empty').hidden = list.length > 0;
  if (!$('#player').src && list.length) watch(list.some((m) => m.id === current) ? current : list[0].id);
}

refresh();
setInterval(refresh, 3000);
