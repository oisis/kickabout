// Shared by every page: Polish/English texts (data-i18n attributes) and the signed-in state in the header.
const TEXT = {
  en: {
    nav_play: 'Play', nav_live: 'Fan zone', nav_download: 'Download',
    live_title: 'Fan zone', live_lead: 'Online matches being played right now. Pick one to watch — players can hide their match.', live_empty: 'No live matches right now. Start one in the game: Online play.', live_pick: 'Pick a match from the list', live_end: 'Full time', live_half: 'Half time', kind_quick: 'Quick match', kind_room: 'Friends\' room', kind_club: 'Club match', nav_account: 'Account', nav_signin: 'Sign in',
    hero_title: 'Arcade football. <span>11 a side.</span>',
    hero_lead: 'Top-down, fast and simple to pick up: run, pass, shoot and slide. Leagues, cups, a 20-season career and online matches with friends.',
    play_now: '▶ Play in the browser', get_android: '⬇ Download for Android',
    features: 'What is inside',
    f1_t: 'Real match day', f1_p: 'Skills, 9 formations, fouls, cards, extra time and shootouts on seven pitch surfaces.',
    f2_t: 'Leagues and career', f2_p: '384 clubs in 8 countries and 40 national teams. Promotion, transfers and finances.',
    f3_t: 'Online with friends', f3_p: 'Quick match or a private room with a 4-letter code. Deterministic lockstep keeps both phones identical.',
    f4_t: 'Editors', f4_p: 'Rename teams, recolour kits, tune players and drag your own tactics.',
    f5_t: 'Touch, keys, gamepad', f5_p: 'Stick on the left, PASS and SHOOT on the right. Two players on one keyboard, portrait or landscape.',
    f6_t: 'Seven languages', f6_p: 'English, Polish, French, German, Italian, Spanish and Dutch.',
    f7_t: 'Live voice chat', f7_p: 'Talk to your friend during a match in a private room — when both of you switch it on. Phone to phone, no lag.',
    f8_t: 'Fan zone', f8_p: 'Watch online matches live in your browser and switch between them whenever you like.', f8_link: 'Open the fan zone →',
    dl_title: 'Android app', dl_lead: 'Free APK, no ads, no tracking. Android 7.0 or newer.',
    dl_1: 'Download the file on your phone.', dl_2: 'Open it and allow installing apps from this source when Android asks.',
    dl_3: 'Start Kickabout. For online play the server address is already filled in.',
    dl_btn: '⬇ Download APK', dl_missing: 'The APK is not published on this server yet.',
    footer: 'Kickabout — all clubs and players are fictional.',
    acc_title: 'Your account',
    club_title: 'My online club', club_none: 'No club yet. Found one or buy an existing club in the game.', club_manage: 'Manage the club in the game', coins: 'coins',
    app_title: 'Connect the app', app_lead: 'In the Android app open “My club (online)” and enter this code. It works once, for 10 minutes.', app_btn: 'Show a code', acc_signin_title: 'Sign in', acc_signin_lead: 'Use an account you already have. We only read your name, e-mail and avatar.',
    with_google: 'Continue with Google', with_github: 'Continue with GitHub', with_dev: 'Sign in (development)',
    dev_name: 'Name', no_providers: 'Sign-in is not configured on this server yet.',
    acc_name: 'Display name', save: 'Save', saved: 'Saved.',
    acc_linked: 'Sign-in methods', link: 'Link', unlink: 'Unlink', linked_ok: 'Account linked.',
    acc_sessions: 'Signed-in devices', this_device: 'this device', signout_others: 'Sign out other devices',
    signout: 'Sign out', danger: 'Delete account', danger_lead: 'Removes your account, sign-in methods and sessions. This cannot be undone.',
    delete: 'Delete my account', confirm_delete: 'Delete your Kickabout account for good?',
    err_state: 'Sign-in expired or was started in another tab. Please try again.', err_taken: 'That account is already linked to another Kickabout user.',
    err_provider: 'The sign-in provider did not answer. Please try again.', err_generic: 'Something went wrong. Please try again.',
    since: 'since', err_banned: 'This account is blocked.',
    online: '{0} online', online_title: 'Players and fans connected right now', nav_admin: 'Admin',
    adm_title: 'Administration', adm_denied: 'Only administrators can open this page.', adm_online: 'Online now', adm_playing: 'playing', adm_waiting: 'waiting', adm_watching: 'watching', adm_matches: 'matches',
    adm_users: 'Accounts', adm_users_n: 'accounts', adm_banned_n: 'blocked', adm_clubs: 'clubs', adm_search: 'Search by name or e-mail', adm_add: 'Add a user', adm_add_lead: 'The account is taken over at the first sign-in (Google or GitHub) with this e-mail address.',
    adm_name: 'Name', adm_email: 'E-mail', adm_add_btn: 'Add', adm_added: 'User added.', adm_exists: 'An account with this e-mail already exists.', adm_bad: 'Check the name and the e-mail address.',
    adm_emails: 'E-mail addresses', adm_copy: 'Copy all', adm_copied: 'Copied.', adm_ban: 'Block', adm_unban: 'Unblock', adm_delete: 'Delete', adm_banned: 'blocked', adm_admin: 'admin', adm_invited: 'waiting for the first sign-in',
    adm_confirm_ban: 'Block {0}? They are signed out everywhere and cannot sign in again.', adm_confirm_delete: 'Delete {0} for good? The account, the coins and the history are removed; the club goes back to the computer.',
    adm_joined: 'joined', adm_seen: 'last sign-in', adm_none: 'No accounts found.',
  },
  pl: {
    nav_play: 'Graj', nav_live: 'Strefa kibica', nav_download: 'Pobierz',
    live_title: 'Strefa kibica', live_lead: 'Mecze online rozgrywane w tej chwili. Wybierz, który chcesz oglądać — gracze mogą ukryć swój mecz.', live_empty: 'Teraz nikt nie gra. Rozpocznij mecz w grze: Gra online.', live_pick: 'Wybierz mecz z listy', live_end: 'Koniec', live_half: 'Przerwa', kind_quick: 'Szybka gra', kind_room: 'Pokój znajomych', kind_club: 'Mecz klubów', nav_account: 'Konto', nav_signin: 'Zaloguj',
    hero_title: 'Zręcznościowa piłka. <span>11 na 11.</span>',
    hero_lead: 'Widok z góry, szybka i prosta: biegnij, podawaj, strzelaj i rób wślizgi. Ligi, puchary, kariera na 20 sezonów i mecze online ze znajomymi.',
    play_now: '▶ Graj w przeglądarce', get_android: '⬇ Pobierz na Androida',
    features: 'Co jest w grze',
    f1_t: 'Prawdziwy dzień meczowy', f1_p: 'Umiejętności, 9 formacji, faule, kartki, dogrywka i karne na siedmiu rodzajach murawy.',
    f2_t: 'Ligi i kariera', f2_p: '384 kluby w 8 krajach i 40 reprezentacji. Awanse, transfery i finanse.',
    f3_t: 'Online ze znajomymi', f3_p: 'Szybka gra albo pokój z 4-literowym kodem. Deterministyczna symulacja trzyma oba telefony w zgodzie.',
    f4_t: 'Edytory', f4_p: 'Zmieniaj nazwy drużyn, kolory strojów, umiejętności i przeciągaj własne taktyki.',
    f5_t: 'Dotyk, klawiatura, pad', f5_p: 'Drążek po lewej, PODANIE i STRZAŁ po prawej. Dwóch graczy na jednej klawiaturze, w pionie i w poziomie.',
    f6_t: 'Siedem języków', f6_p: 'Polski, angielski, francuski, niemiecki, włoski, hiszpański i niderlandzki.',
    f7_t: 'Rozmowy na żywo', f7_p: 'Rozmawiaj ze znajomym w czasie meczu w prywatnym pokoju — gdy obaj to włączycie. Bezpośrednio między telefonami, bez lagów.',
    f8_t: 'Strefa kibica', f8_p: 'Oglądaj mecze online na żywo w przeglądarce i przełączaj się między nimi, kiedy chcesz.', f8_link: 'Otwórz strefę kibica →',
    dl_title: 'Aplikacja na Androida', dl_lead: 'Darmowy APK, bez reklam i śledzenia. Android 7.0 lub nowszy.',
    dl_1: 'Pobierz plik na telefonie.', dl_2: 'Otwórz go i zezwól na instalację z tego źródła, gdy Android zapyta.',
    dl_3: 'Uruchom Kickabout. Adres serwera do gry online jest już wpisany.',
    dl_btn: '⬇ Pobierz APK', dl_missing: 'APK nie jest jeszcze opublikowany na tym serwerze.',
    footer: 'Kickabout — wszystkie kluby i zawodnicy są fikcyjni.',
    acc_title: 'Twoje konto',
    club_title: 'Mój klub online', club_none: 'Nie masz jeszcze klubu. Załóż go albo kup istniejący w grze.', club_manage: 'Zarządzaj klubem w grze', coins: 'monet',
    app_title: 'Połącz aplikację', app_lead: 'W aplikacji na Androida otwórz „Mój klub (online)” i wpisz ten kod. Działa raz, przez 10 minut.', app_btn: 'Pokaż kod', acc_signin_title: 'Zaloguj się', acc_signin_lead: 'Użyj konta, które już masz. Odczytujemy tylko imię, e-mail i awatar.',
    with_google: 'Kontynuuj z Google', with_github: 'Kontynuuj z GitHub', with_dev: 'Zaloguj (tryb deweloperski)',
    dev_name: 'Imię', no_providers: 'Logowanie nie jest jeszcze skonfigurowane na tym serwerze.',
    acc_name: 'Nazwa wyświetlana', save: 'Zapisz', saved: 'Zapisano.',
    acc_linked: 'Metody logowania', link: 'Połącz', unlink: 'Odłącz', linked_ok: 'Konto połączone.',
    acc_sessions: 'Zalogowane urządzenia', this_device: 'to urządzenie', signout_others: 'Wyloguj inne urządzenia',
    signout: 'Wyloguj', danger: 'Usuń konto', danger_lead: 'Usuwa konto, metody logowania i sesje. Tego nie da się cofnąć.',
    delete: 'Usuń moje konto', confirm_delete: 'Na pewno usunąć konto Kickabout?',
    err_state: 'Logowanie wygasło albo zaczęło się w innej karcie. Spróbuj ponownie.', err_taken: 'To konto jest już połączone z innym użytkownikiem Kickabout.',
    err_provider: 'Dostawca logowania nie odpowiedział. Spróbuj ponownie.', err_generic: 'Coś poszło nie tak. Spróbuj ponownie.',
    since: 'od', err_banned: 'To konto jest zablokowane.',
    online: '{0} online', online_title: 'Gracze i kibice połączeni w tej chwili', nav_admin: 'Admin',
    adm_title: 'Administracja', adm_denied: 'Tę stronę mogą otworzyć tylko administratorzy.', adm_online: 'Teraz online', adm_playing: 'gra', adm_waiting: 'czeka', adm_watching: 'ogląda', adm_matches: 'mecze',
    adm_users: 'Konta', adm_users_n: 'konta', adm_banned_n: 'zablokowane', adm_clubs: 'kluby', adm_search: 'Szukaj po nazwie lub e-mailu', adm_add: 'Dodaj użytkownika', adm_add_lead: 'Konto przejmie osoba, która pierwszy raz zaloguje się (Google lub GitHub) tym adresem e-mail.',
    adm_name: 'Nazwa', adm_email: 'E-mail', adm_add_btn: 'Dodaj', adm_added: 'Dodano użytkownika.', adm_exists: 'Konto z tym adresem e-mail już istnieje.', adm_bad: 'Sprawdź nazwę i adres e-mail.',
    adm_emails: 'Adresy e-mail', adm_copy: 'Kopiuj wszystkie', adm_copied: 'Skopiowano.', adm_ban: 'Zablokuj', adm_unban: 'Odblokuj', adm_delete: 'Usuń', adm_banned: 'zablokowany', adm_admin: 'admin', adm_invited: 'czeka na pierwsze logowanie',
    adm_confirm_ban: 'Zablokować {0}? Zostanie wylogowany wszędzie i nie zaloguje się ponownie.', adm_confirm_delete: 'Usunąć {0} na zawsze? Znikną konto, monety i historia, a klub wróci do komputera.',
    adm_joined: 'od', adm_seen: 'ostatnie logowanie', adm_none: 'Brak kont.',
  },
};

const saved = (() => { try { return localStorage.getItem('kickabout.lang'); } catch { return null; } })();
export const lang = saved === 'pl' || saved === 'en' ? saved : navigator.language.startsWith('pl') ? 'pl' : 'en';
export const t = (k) => TEXT[lang][k] ?? TEXT.en[k] ?? k;

/** The API: behind this site at /api, or on its own subdomain (config.js, written when the container starts). */
export const API = (window.KICKABOUT?.api || '/api').replace(/\/$/, '');
export const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...init.headers } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

function translate() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  const sel = document.querySelector('.lang');
  if (sel) {
    sel.value = lang;
    // The game shares this setting (same origin), so it opens in the same language.
    sel.onchange = () => { try { localStorage.setItem('kickabout.lang', sel.value); } catch { /* storage blocked */ } location.reload(); };
  }
}

/** Shows the signed-in user (avatar and name) in place of "Sign in". */
export function setHeader(user) {
  const link = document.querySelector('#account-link');
  if (!link) return;
  link.textContent = '';
  if (user.avatar) link.append(Object.assign(document.createElement('img'), { className: 'avatar', src: user.avatar, alt: '' }), ' ');
  link.append(user.name);
  if (user.admin && !document.querySelector('#admin-link')) link.before(Object.assign(document.createElement('a'), { id: 'admin-link', href: '/admin.html', textContent: t('nav_admin') }));
}

/** "● 12 online" in the header: players in matches, players waiting for one and fans. */
async function online() {
  const nav = document.querySelector('header nav');
  if (!nav) return;
  let badge = nav.querySelector('.online');
  if (!badge) { badge = Object.assign(document.createElement('span'), { className: 'online', title: t('online_title') }); badge.hidden = true; nav.prepend(badge); }
  const { status, data } = await api('/online').catch(() => ({ status: 0 }));
  if (status === 200) {
    const [before, after] = t('online').split('{0}');
    badge.replaceChildren(before, Object.assign(document.createElement('b'), { textContent: data.online.toLocaleString(lang) }), Object.assign(document.createElement('span'), { className: 'lbl', textContent: after }));
    badge.hidden = false;
  }
}

async function header() {
  const { status, data } = await api('/me').catch(() => ({ status: 0 }));
  if (status === 200) setHeader(data);
}

translate();
header();
online();
setInterval(() => { if (!document.hidden) online(); }, 20_000);
// Version of the running API in the footer.
api('/version').then(({ data }) => { const f = document.querySelector('footer .wrap'); if (f && data.version) f.append(` • v${data.version}`); }).catch(() => {});
