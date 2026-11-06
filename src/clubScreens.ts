// "My club": the player's online club kept on the server (needs a Kickabout account).
// Squad, coins, transfer market, swaps, offers from other players, sponsoring, buying
// a club and prize matches against the computer that the server verifies.
import { POS, LEAGUE_COUNTRIES, leagueLabel, teamSetup, type TeamDef, type PlayerDef } from './data.ts';
import { makeSpec } from './match.ts';
import { options, minuteOptions } from './store.ts';
import { api, setToken, rle } from './api.ts';
import { inApp, siteUrl } from './net.ts';
import { h, show, title, btn, row, back, select, input, table, toast } from './ui.ts';
import { t as tr, lang } from './i18n.ts';
import type { App } from './main.ts';

interface Player extends PlayerDef { price: number }
interface ClubDetail { id: string; name: string; short: string; rating: number; price: number; owner: string | null; ownerId: number | null; mine: boolean; team: TeamDef; players: Player[]; sponsors: { name: string; amount: number }[]; buyPrice: number | null }
interface Offer { id: number; kind: 'player' | 'swap' | 'club'; give: string; take: string; price: number; incoming: boolean; from: string; to: string; club: string }
interface MyClub { coins: number; club: ClubDetail | null; offers: Offer[]; ledger: { amount: number; balance: number; kind: string; note: string; created: number }[]; rewardsLeft: { cpu: number; online: number } }

const coins = (n: number) => `${n.toLocaleString(lang())} 🪙`;
const skill = (p: PlayerDef) => (p.pos === 0 ? p.gk : Math.round((p.pa + p.sh + p.he + p.ta + p.co + p.sp) / 6));
const ERRORS: Record<string, string> = {
  coins: tr('Za mało monet'), 'has-club': tr('Masz już klub'), 'no-club': tr('Najpierw załóż albo kup klub'), 'squad-small': tr('Za mały skład (minimum 14)'),
  'squad-full': tr('Pełny skład (maksimum 22)'), 'last-keeper': tr('Drużyna musi mieć bramkarza'), changed: tr('Oferta jest już nieaktualna'), limit: tr('Wykorzystano dzienny limit meczów o nagrodę'),
  name: tr('Nazwa: 3–24 znaki'), short: tr('Skrót: 3 litery'), amount: tr('Za mała kwota'), incomplete: tr('Mecz nie został dokończony'),
};
const fail = (r: { status: number; data: unknown }) => toast(r.status === 0 ? tr('Brak połączenia z serwerem') : ERRORS[(r.data as { error?: string }).error ?? ''] ?? tr('Coś poszło nie tak'));
const ask = (text: string, value: number) => { const v = prompt(text, String(value)); return v === null ? null : Math.round(Number(v)); };

export async function clubMenu(app: App) {
  show(title(tr('Mój klub'), tr('Wczytywanie…')));
  const r = await api<MyClub>('/me/club');
  if (r.status === 401) return signIn(app);
  if (r.status !== 200) return show(title(tr('Mój klub'), tr('Brak połączenia z serwerem')), back(() => app.menu()));
  const d = r.data, c = d.club;
  if (!c) return newClub(app, d);
  const incoming = d.offers.filter((o) => o.incoming).length;
  show(
    title(c.name, `${coins(d.coins)} • ${tr('ocena {0}', c.rating)} • ${tr('wartość {0}', coins(c.price))}`),
    c.sponsors.length > 0 && h('p', { className: 'sub' }, tr('Sponsorzy: {0}', c.sponsors.map((s) => s.name).join(', '))),
    h('nav', {},
      btn(tr('Mecz o nagrodę ({0} dziś)', d.rewardsLeft.cpu), () => prizeMatch(app, d), 'primary big'),
      btn(tr('Skład'), () => squad(app, d)),
      btn(tr('Rynek transferowy'), () => market(app, d)),
      btn(incoming ? tr('Oferty ({0} nowe)', incoming) : tr('Oferty'), () => offers(app, d)),
      btn(tr('Historia konta'), () => ledger(app, d)),
      btn(tr('Opuść klub'), async () => {
        if (!confirm(tr('Opuścić klub? Wróci pod zarząd komputera i każdy będzie mógł go kupić.'))) return;
        const x = await api('/me/club/leave', {});
        if (x.status === 200) clubMenu(app); else fail(x);
      }, 'ghost'),
    ),
    h('p', { className: 'hint' }, tr('Klub bez Twojej aktywności przez 30 dni wraca pod zarząd komputera.')),
    back(() => app.menu()),
  );
}

function signIn(app: App) {
  const site = siteUrl();
  let code = '';
  show(
    title(tr('Mój klub'), tr('Klub online wymaga konta Kickabout.')),
    inApp() && h('p', {}, tr('Na stronie, w panelu konta, wybierz „Połącz aplikację” i wpisz tu kod.')),
    inApp() && input(tr('Kod z panelu konta'), '', (v) => { code = v; }, { maxLength: 6, autocapitalize: 'characters' }),
    inApp() && btn(tr('Połącz z kontem'), async () => {
      const r = await api<{ token: string }>('/app-token', { code });
      if (r.status !== 200) return toast(r.status === 0 ? tr('Brak połączenia z serwerem') : tr('Nieprawidłowy albo wygasły kod'));
      setToken(r.data.token);
      clubMenu(app);
    }, 'primary'),
    site && btn(inApp() ? tr('Otwórz stronę konta') : tr('Zaloguj się na stronie'), () => { location.href = `${site.replace(/\/$/, '')}/account.html`; }, inApp() ? 'ghost' : 'primary'),
    back(() => app.menu()),
  );
}

function newClub(app: App, d: MyClub) {
  const f = { name: '', short: '', shirt: '#dc2626', shorts: '#f8fafc' };
  const color = (label: string, k: 'shirt' | 'shorts') => h('label', { className: 'field' }, h('span', {}, label), h('input', { type: 'color', value: f[k], oninput: (e: Event) => { f[k] = (e.target as HTMLInputElement).value; } }));
  show(
    title(tr('Załóż klub'), tr('Masz {0}. Nowy klub dostaje 16 losowych, raczej słabych zawodników.', coins(d.coins))),
    input(tr('Nazwa klubu'), '', (v) => { f.name = v; }, { maxLength: 24 }),
    input(tr('Skrót (3 litery)'), '', (v) => { f.short = v.toUpperCase(); }, { maxLength: 3, autocapitalize: 'characters' }),
    h('div', { className: 'colors' }, color(tr('Koszulka'), 'shirt'), color(tr('Spodenki'), 'shorts')),
    btn(tr('Załóż klub'), async () => {
      const r = await api('/me/club', { ...f, lang: lang() });
      if (r.status === 200) clubMenu(app); else fail(r);
    }, 'primary'),
    btn(tr('Kup istniejący klub'), () => market(app, d), 'ghost'),
    back(() => app.menu()),
  );
}

function squad(app: App, d: MyClub) {
  const c = d.club!;
  show(
    title(tr('Skład'), tr('Dotknij zawodnika, aby go sprzedać ({0}% wartości)', 60)),
    table([tr('Poz'), tr('Zawodnik'), tr('Wiek'), tr('Oc'), tr('Wartość')], c.players.map((p) => [tr(POS[p.pos]), p.name, p.age, skill(p), coins(p.price)]), async (i) => {
      const p = c.players[i], paid = Math.round(p.price * 0.6);
      if (!confirm(tr('Sprzedać {0} za {1}?', p.name, coins(paid)))) return;
      const r = await api('/me/club/sell', { player: p.name });
      if (r.status === 200) { toast(tr('Sprzedano za {0}', coins(r.data.paid))); clubMenu(app); } else fail(r);
    }),
    back(() => clubMenu(app)),
  );
}

async function market(app: App, d: MyClub, group = `${LEAGUE_COUNTRIES.find((c) => c.code === 'pl')?.code ?? 'en'}:4`) {
  const groups: [string, string][] = [
    ['owned', tr('Kluby graczy (z właścicielem)')], ['players', tr('Kluby założone przez graczy')],
    ...LEAGUE_COUNTRIES.flatMap(({ code, name }) => [1, 2, 3, 4].map((dv): [string, string] => [`${code}:${dv}`, leagueLabel(name, dv)])),
  ];
  const r = await api<{ id: string; name: string; rating: number; price: number; owner: string | null }[]>(`/clubs?group=${encodeURIComponent(group)}`);
  if (r.status !== 200) return fail(r);
  show(
    title(tr('Rynek transferowy'), `${coins(d.coins)}`),
    select(tr('Pokaż'), group, groups, (g) => market(app, d, g)),
    r.data.length ? table([tr('Klub'), tr('Oc'), tr('Cena'), tr('Właściciel')], r.data.map((x) => [x.name, x.rating, coins(x.price), x.owner ?? tr('komputer')]), (i) => clubView(app, d, r.data[i].id, group))
      : h('p', { className: 'sub' }, tr('Brak klubów')),
    back(() => (d.club ? clubMenu(app) : newClub(app, d))),
  );
}

async function clubView(app: App, d: MyClub, id: string, group: string) {
  const r = await api<ClubDetail>(`/clubs/${id}`);
  if (r.status !== 200) return fail(r);
  const c = r.data, mine = d.club, owned = c.ownerId !== null;
  const done = async (x: { status: number; data: { offer?: number; error?: string } }) => {
    if (x.status !== 200) return fail(x);
    toast(x.data.offer ? tr('Wysłano ofertę do właściciela') : tr('Gotowe'));
    const fresh = await api<MyClub>('/me/club');
    if (fresh.status === 200) clubView(app, fresh.data, id, group);
  };
  show(
    title(c.name, `${owned ? tr('Właściciel: {0}', c.owner ?? '') : tr('Zarząd: komputer')} • ${tr('ocena {0}', c.rating)}`),
    c.sponsors.length > 0 && h('p', { className: 'sub' }, tr('Sponsorzy: {0}', c.sponsors.map((s) => s.name).join(', '))),
    !c.mine && !mine && btn(owned ? tr('Zaproponuj kupno klubu') : tr('Kup klub za {0}', coins(c.price)), async () => {
      if (owned) { const v = ask(tr('Ile oferujesz za klub?'), c.price); if (v !== null) done(await api(`/clubs/${id}/buy`, { price: v })); }
      else if (confirm(tr('Kupić {0} za {1}?', c.name, coins(c.price)))) done(await api(`/clubs/${id}/buy`, {}));
    }, 'primary'),
    !c.mine && owned && btn(tr('Sponsoruj klub'), async () => {
      const v = ask(tr('Kwota sponsoringu (min. {0}). Twoja nazwa pojawi się na bandach w meczach tego klubu.', 100), 100);
      if (v !== null) done(await api(`/clubs/${id}/sponsor`, { amount: v }));
    }),
    mine && !c.mine && btn(tr('Zagraj z tym klubem o nagrodę'), () => prizeMatch(app, d, id)),
    h('p', { className: 'hint' }, mine && !c.mine ? tr('Dotknij zawodnika, aby go kupić albo wymienić') : ''),
    table([tr('Poz'), tr('Zawodnik'), tr('Wiek'), tr('Oc'), tr('Wartość')], c.players.map((p) => [tr(POS[p.pos]), p.name, p.age, skill(p), coins(p.price)]), (i) => mine && !c.mine && playerDeal(app, d, c, c.players[i], done)),
    back(() => market(app, d, group)),
  );
}

function playerDeal(app: App, d: MyClub, c: ClubDetail, p: Player, done: (x: { status: number; data: any }) => void) {
  const owned = c.ownerId !== null, buyPrice = Math.round(p.price * 1.25);
  const mine = d.club!.players;
  let give = mine[0].name;
  const gap = () => { const g = mine.find((x) => x.name === give)!; const diff = p.price - g.price; return diff >= 0 ? Math.round(diff * 1.1) : -Math.round(-diff * 0.8); };
  const draw = () => show(
    title(p.name, `${tr(POS[p.pos])} • ${tr('ocena {0}', skill(p))} • ${coins(p.price)}`),
    h('p', { className: 'sub' }, owned ? tr('Klub gracza {0}: transakcja wymaga jego zgody.', c.owner ?? '') : tr('Klub komputera: transakcja od razu, jeśli masz monety.')),
    btn(owned ? tr('Zaproponuj kupno') : tr('Kup za {0}', coins(buyPrice)), async () => {
      if (owned) { const v = ask(tr('Ile oferujesz?'), p.price); if (v !== null) done(await api(`/clubs/${c.id}/buy-player`, { player: p.name, price: v })); }
      else done(await api(`/clubs/${c.id}/buy-player`, { player: p.name }));
    }, 'primary'),
    select(tr('Wymień za mojego zawodnika'), give, mine.map((x): [string, string] => [x.name, `${x.name} (${tr(POS[x.pos])}, ${skill(x)}, ${coins(x.price)})`]), (v) => { give = v; draw(); }),
    h('p', { className: 'sub' }, gap() >= 0 ? tr('Dopłacasz {0}', coins(gap())) : tr('Otrzymujesz {0}', coins(-gap()))),
    btn(owned ? tr('Zaproponuj wymianę') : tr('Wymień'), async () => done(await api(`/clubs/${c.id}/swap`, { give, take: p.name }))),
    back(() => clubView(app, d, c.id, 'owned')),
  );
  draw();
}

function offers(app: App, d: MyClub) {
  const label = (o: Offer) => o.kind === 'club' ? tr('Klub {0}', o.club) : o.kind === 'player' ? `${o.take} (${o.club})` : `${o.give} ⇄ ${o.take}`;
  const act = async (o: Offer, a: string) => { const r = await api(`/offers/${o.id}/${a}`, {}); if (r.status === 200) clubMenu(app); else fail(r); };
  show(
    title(tr('Oferty')),
    !d.offers.length && h('p', { className: 'sub' }, tr('Brak otwartych ofert')),
    h('ul', { className: 'list' }, ...d.offers.map((o) => h('li', {},
      h('span', {}, `${o.incoming ? `⬅ ${o.from}` : `➡ ${o.to}`}: ${label(o)} — ${o.price >= 0 ? coins(o.price) : tr('dopłata dla kupującego {0}', coins(-o.price))}`),
      ...(o.incoming ? [btn('✔', () => act(o, 'accept')), btn('✕', () => act(o, 'reject'), 'ghost')] : [btn('✕', () => act(o, 'cancel'), 'ghost')]),
    ))),
    back(() => clubMenu(app)),
  );
}

const KINDS: Record<string, string> = {
  'reward-cpu': tr('Nagroda: mecz z komputerem'), 'reward-online': tr('Nagroda: mecz online'), 'player-buy': tr('Kupno zawodnika'), 'player-sell': tr('Sprzedaż zawodnika'),
  swap: tr('Wymiana'), 'swap-buy': tr('Wymiana'), 'swap-sell': tr('Wymiana'), 'club-buy': tr('Kupno klubu'), 'club-sell': tr('Sprzedaż klubu'), sponsor: tr('Sponsoring'), sponsored: tr('Od sponsora'),
};
function ledger(app: App, d: MyClub) {
  show(
    title(tr('Historia konta'), coins(d.coins)),
    table(['', tr('Kwota'), tr('Saldo')], d.ledger.map((l) => [`${KINDS[l.kind] ?? l.kind}${l.note ? ` — ${l.note}` : ''}`, `${l.amount > 0 ? '+' : ''}${l.amount}`, l.balance])),
    back(() => clubMenu(app)),
  );
}

/** A match against a computer club for prize money: the server picks the seed and replays our inputs. */
function prizeMatch(app: App, d: MyClub, opponent?: string) {
  let minutes = options().minutes;
  show(
    title(tr('Mecz o nagrodę'), tr('Pozostało dziś: {0}. Wynik sprawdza serwer, więc mecz trzeba dograć do końca.', d.rewardsLeft.cpu)),
    select(tr('Długość meczu'), minutes, minuteOptions(), (v) => { minutes = v; }),
    btn(opponent ? tr('Graj!') : tr('Losuj rywala o podobnej sile i graj'), async () => {
      const r = await api<{ id: string; seed: number; minutes: number; pitch: number; home: TeamDef; away: TeamDef; reward: { win: number; draw: number } }>('/me/matches', { minutes, opponent });
      if (r.status !== 200) return fail(r);
      const m = r.data;
      toast(tr('Nagroda: wygrana {0}, remis {1}', coins(m.reward.win), coins(m.reward.draw)));
      const spec = makeSpec({ team: m.home, human: 1 }, { team: m.away, human: 0 }, { ...options(), pitch: m.pitch, autoReplay: false }, { minutes: m.minutes, extraTime: false, penalties: false }, m.seed);
      spec.setup = { teams: [teamSetup(m.home), teamSetup(m.away)], minutes: m.minutes, extraTime: false, penalties: false, pitch: m.pitch }; // what the server replays
      spec.record = true;
      app.startMatch(spec, async (_s, run) => {
        show(title(tr('Sprawdzanie wyniku…')));
        const x = await api<{ score: number[]; reward: number; coins: number }>(`/me/matches/${m.id}`, { inputs: rle(run.recorded) });
        if (x.status !== 200) { fail(x); return clubMenu(app); }
        show(
          title(tr('Nagroda: {0}', coins(x.data.reward)), `${m.home.short} ${x.data.score[0]}:${x.data.score[1]} ${m.away.short} • ${tr('stan konta: {0}', coins(x.data.coins))}`),
          btn(tr('Dalej'), () => clubMenu(app), 'primary'),
        );
      });
    }, 'primary big'),
    back(() => clubMenu(app)),
  );
}
