// Clubs of eight European leagues (two divisions each) and 40 national teams,
// generated deterministically so every device and both online peers build
// byte-identical teams from the same id. Club names pair a real city with an
// invented nickname; players are fictional.
import { type Skills, type TeamSetup, type MatchSetup, FORMATIONS, lineOf } from './sim.ts';
import { t } from './i18n.ts';
import { MATCH_MINUTES } from './store.ts';
import { NAMES, NATION_POOL } from './names.ts';

export interface PlayerDef extends Skills { name: string; age: number }
export interface Kit { shirt: string; shorts: string }
export interface TeamDef {
  id: string;
  name: string;
  short: string;
  national: boolean;
  country: string; // league country code for clubs, region (eu / world) for nations
  division: number; // 1..4 for clubs, 0 for nations
  level: number; // 1..9 team strength
  kits: [Kit, Kit];
  keeper: string;
  formation: number; // index into FORMATIONS
  players: PlayerDef[]; // 16: 2 GK, 5 DEF, 5 MID, 4 ATT
  sponsors?: string[]; // online clubs: top sponsors' names, shown before kick-off and on the boards
}

export const POS = ['BR', 'OB', 'PO', 'NA']; // bramkarz, obrońca, pomocnik, napastnik (translated on display)

function prng(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}

function hashId(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const clamp9 = (v: number) => Math.max(0, Math.min(9, v));
// Skill bias per position: pa sh he ta co sp
const BIAS = [[-2, -2, -2, -2, 0, 0], [0, -2, 1, 2, 0, 0], [2, 0, 0, 0, 1, 0], [0, 2, 1, -2, 1, 1]];
const SQUAD_POS = [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 0, 1, 2, 2, 3]; // 11 starters (4-4-2) + 5 bench

export function makePlayers(id: string, level: number, lang: string): PlayerDef[] {
  const r = prng(hashId(id)), rn = prng(hashId(`${id}/names`)); // names have their own stream: lists can change without touching skills
  const [first, last] = NAMES[lang] ?? NAMES.en;
  const used = new Set<string>();
  return SQUAD_POS.map((pos) => {
    let name = '';
    do name = `${first[rn(first.length)]} ${last[rn(last.length)]}`; while (used.has(name)); // full first name: the commentary line and squads show it
    used.add(name);
    const v = (k: number) => clamp9(level + r(5) - 2 + BIAS[pos][k]);
    return { name, pos, pa: v(0), sh: v(1), he: v(2), ta: v(3), co: v(4), sp: v(5), gk: pos === 0 ? clamp9(level + r(5) - 1) : 0, age: 18 + r(16) };
  });
}

// League countries: code, Polish name (translated), player-name pool, 48 cities (12 per division, strongest first), 24 invented nicknames.
const LEAGUES: [string, string, string, string[], string[]][] = [
  ['en', 'Anglia', 'en',
    ['London', 'Manchester', 'Liverpool', 'Birmingham', 'Newcastle', 'Leeds', 'Sheffield', 'Bristol', 'Nottingham', 'Leicester', 'Southampton', 'Brighton', 'Norwich', 'Coventry', 'Derby', 'Hull', 'Plymouth', 'Portsmouth', 'Sunderland', 'Reading', 'Middlesbrough', 'Ipswich', 'Stoke', 'Bolton',
     'Blackburn', 'Burnley', 'Preston', 'Oxford', 'Cambridge', 'Peterborough', 'Luton', 'Watford', 'Swindon', 'Exeter', 'Gloucester', 'Lincoln', 'York', 'Carlisle', 'Doncaster', 'Barnsley', 'Rotherham', 'Wigan', 'Blackpool', 'Northampton', 'Milton Keynes', 'Colchester', 'Cheltenham', 'Shrewsbury'],
    ['Ravens', 'Comets', 'Falcons', 'Stags', 'Otters', 'Thunder', 'Pilots', 'Lanterns', 'Navigators', 'Hawks', 'Badgers', 'Kestrels', 'Herons', 'Lynx', 'Cyclones', 'Pioneers', 'Sentinels', 'Voyagers', 'Bison', 'Sparrows', 'Titans', 'Knights', 'Rockets', 'Harriers']],
  ['es', 'Hiszpania', 'es',
    ['Madrid', 'Barcelona', 'Sevilla', 'Valencia', 'Bilbao', 'Málaga', 'Zaragoza', 'Vigo', 'Gijón', 'Pamplona', 'Valladolid', 'Granada', 'Cádiz', 'Alicante', 'Córdoba', 'Murcia', 'Almería', 'Huelva', 'Oviedo', 'Santander', 'Vitoria', 'Getafe', 'Elche', 'Tarragona',
     'Albacete', 'Burgos', 'Castellón', 'Huesca', 'León', 'Logroño', 'Lugo', 'Ourense', 'Ponferrada', 'Salamanca', 'Soria', 'Teruel', 'Toledo', 'Badajoz', 'Cáceres', 'Jaén', 'Lleida', 'Girona', 'Ferrol', 'Mérida', 'Talavera', 'Algeciras', 'Marbella', 'Reus'],
    ['Halcones', 'Cometas', 'Linces', 'Truenos', 'Pilotos', 'Faros', 'Marineros', 'Gavilanes', 'Tejones', 'Garzas', 'Ciclones', 'Pioneros', 'Centinelas', 'Viajeros', 'Bisontes', 'Gorriones', 'Titanes', 'Caballeros', 'Cohetes', 'Cuervos', 'Nutrias', 'Ciervos', 'Relámpagos', 'Vientos']],
  ['de', 'Niemcy', 'de',
    ['Berlin', 'München', 'Hamburg', 'Köln', 'Frankfurt', 'Stuttgart', 'Dortmund', 'Bremen', 'Leipzig', 'Düsseldorf', 'Hannover', 'Nürnberg', 'Freiburg', 'Mainz', 'Bochum', 'Augsburg', 'Kiel', 'Rostock', 'Karlsruhe', 'Bielefeld', 'Kaiserslautern', 'Dresden', 'Darmstadt', 'Paderborn',
     'Münster', 'Aachen', 'Essen', 'Duisburg', 'Braunschweig', 'Magdeburg', 'Halle', 'Erfurt', 'Jena', 'Chemnitz', 'Zwickau', 'Regensburg', 'Ingolstadt', 'Würzburg', 'Ulm', 'Saarbrücken', 'Osnabrück', 'Oldenburg', 'Lübeck', 'Wiesbaden', 'Heidenheim', 'Sandhausen', 'Aue', 'Cottbus'],
    ['Falken', 'Kometen', 'Luchse', 'Donner', 'Piloten', 'Laternen', 'Seefahrer', 'Habichte', 'Dachse', 'Turmfalken', 'Reiher', 'Zyklone', 'Pioniere', 'Wächter', 'Reisende', 'Bisons', 'Spatzen', 'Titanen', 'Ritter', 'Raketen', 'Raben', 'Otter', 'Hirsche', 'Blitze']],
  ['it', 'Włochy', 'it',
    ['Roma', 'Milano', 'Torino', 'Napoli', 'Genova', 'Firenze', 'Bologna', 'Verona', 'Bergamo', 'Udine', 'Cagliari', 'Lecce', 'Parma', 'Palermo', 'Bari', 'Empoli', 'Venezia', 'Salerno', 'Cremona', 'Brescia', 'Modena', 'Pisa', 'Como', 'Perugia',
     'Ascoli', 'Avellino', 'Benevento', 'Catania', 'Catanzaro', 'Cesena', 'Cosenza', 'Crotone', 'Ferrara', 'Foggia', 'Frosinone', 'Livorno', 'Lucca', 'Mantova', 'Messina', 'Monza', 'Novara', 'Padova', 'Pescara', 'Piacenza', 'Reggio Emilia', 'Siena', 'Taranto', 'Trieste'],
    ['Falchi', 'Comete', 'Linci', 'Tuoni', 'Piloti', 'Lanterne', 'Marinai', 'Sparvieri', 'Tassi', 'Gheppi', 'Aironi', 'Cicloni', 'Pionieri', 'Sentinelle', 'Viaggiatori', 'Bisonti', 'Passeri', 'Titani', 'Cavalieri', 'Razzi', 'Corvi', 'Lontre', 'Cervi', 'Fulmini']],
  ['fr', 'Francja', 'fr',
    ['Paris', 'Marseille', 'Lyon', 'Lille', 'Nice', 'Bordeaux', 'Nantes', 'Toulouse', 'Rennes', 'Strasbourg', 'Montpellier', 'Lens', 'Reims', 'Brest', 'Lorient', 'Metz', 'Auxerre', 'Angers', 'Le Havre', 'Caen', 'Nancy', 'Grenoble', 'Dijon', 'Amiens',
     'Ajaccio', 'Annecy', 'Bastia', 'Besançon', 'Bourg', 'Clermont', 'Dunkerque', 'Guingamp', 'Laval', 'Le Mans', 'Niort', 'Orléans', 'Pau', 'Rodez', 'Saint-Étienne', 'Sedan', 'Montbéliard', 'Tours', 'Troyes', 'Valenciennes', 'Versailles', 'Châteauroux', 'Boulogne', 'Cholet'],
    ['Faucons', 'Comètes', 'Lynx', 'Tonnerres', 'Pilotes', 'Lanternes', 'Marins', 'Éperviers', 'Blaireaux', 'Crécerelles', 'Hérons', 'Cyclones', 'Pionniers', 'Sentinelles', 'Voyageurs', 'Bisons', 'Moineaux', 'Titans', 'Chevaliers', 'Fusées', 'Corbeaux', 'Loutres', 'Cerfs', 'Éclairs']],
  ['nl', 'Holandia', 'nl',
    ['Amsterdam', 'Rotterdam', 'Eindhoven', 'Utrecht', 'Den Haag', 'Groningen', 'Enschede', 'Alkmaar', 'Arnhem', 'Nijmegen', 'Tilburg', 'Breda', 'Zwolle', 'Heerenveen', 'Almere', 'Sittard', 'Waalwijk', 'Volendam', 'Deventer', 'Leeuwarden', 'Maastricht', 'Emmen', 'Venlo', 'Dordrecht',
     'Haarlem', 'Leiden', 'Delft', 'Zaandam', 'Hilversum', 'Amersfoort', 'Apeldoorn', 'Hengelo', 'Oss', 'Helmond', 'Roosendaal', 'Bergen op Zoom', 'Den Bosch', 'Veendam', 'Assen', 'Zwijndrecht', 'Katwijk', 'Spakenburg', 'Kampen', 'Harderwijk', 'Hoorn', 'Purmerend', 'Gouda', 'Vlaardingen'],
    ['Valken', 'Kometen', 'Lynxen', 'Donders', 'Piloten', 'Lantaarns', 'Zeelui', 'Haviken', 'Dassen', 'Torenvalken', 'Reigers', 'Cyclonen', 'Pioniers', 'Wachters', 'Reizigers', 'Bizons', 'Mussen', 'Titanen', 'Ridders', 'Raketten', 'Raven', 'Otters', 'Herten', 'Bliksems']],
  ['pt', 'Portugalia', 'pt',
    ['Lisboa', 'Porto', 'Braga', 'Guimarães', 'Coimbra', 'Faro', 'Funchal', 'Aveiro', 'Setúbal', 'Leiria', 'Vizela', 'Barcelos', 'Famalicão', 'Chaves', 'Portimão', 'Viseu', 'Estoril', 'Arouca', 'Penafiel', 'Covilhã', 'Tondela', 'Mafra', 'Feira', 'Torres Novas',
     'Évora', 'Beja', 'Bragança', 'Vila Real', 'Castelo Branco', 'Portalegre', 'Santarém', 'Póvoa de Varzim', 'Vila do Conde', 'Matosinhos', 'Gondomar', 'Amadora', 'Sintra', 'Cascais', 'Oeiras', 'Almada', 'Seixal', 'Barreiro', 'Montijo', 'Olhão', 'Lagos', 'Tavira', 'Ponta Delgada', 'Angra do Heroísmo'],
    ['Falcões', 'Cometas', 'Linces', 'Trovões', 'Pilotos', 'Lanternas', 'Marinheiros', 'Gaviões', 'Texugos', 'Garças', 'Ciclones', 'Pioneiros', 'Sentinelas', 'Viajantes', 'Bisontes', 'Pardais', 'Titãs', 'Cavaleiros', 'Foguetes', 'Corvos', 'Lontras', 'Veados', 'Relâmpagos', 'Faróis']],
  ['pl', 'Polska', 'pl',
    ['Warszawa', 'Kraków', 'Poznań', 'Gdańsk', 'Wrocław', 'Łódź', 'Szczecin', 'Katowice', 'Białystok', 'Lublin', 'Gliwice', 'Chorzów', 'Zabrze', 'Bydgoszcz', 'Kielce', 'Rzeszów', 'Radom', 'Opole', 'Płock', 'Gdynia', 'Olsztyn', 'Toruń', 'Częstochowa', 'Legnica',
     'Elbląg', 'Koszalin', 'Słupsk', 'Gorzów Wielkopolski', 'Zielona Góra', 'Kalisz', 'Konin', 'Piła', 'Włocławek', 'Grudziądz', 'Siedlce', 'Łomża', 'Suwałki', 'Ostrołęka', 'Tarnów', 'Nowy Sącz', 'Przemyśl', 'Krosno', 'Zamość', 'Chełm', 'Jelenia Góra', 'Wałbrzych', 'Rybnik', 'Bielsko-Biała'],
    ['Burza', 'Iskra', 'Kometa', 'Grom', 'Wicher', 'Sokoły', 'Orlęta', 'Błyskawica', 'Huragan', 'Jastrzębie', 'Rysie', 'Żurawie', 'Czaple', 'Borsuki', 'Pionierzy', 'Strażnicy', 'Wędrowcy', 'Żubry', 'Wróble', 'Tytani', 'Rycerze', 'Rakiety', 'Kruki', 'Wydry']],
];
export const LEAGUE_COUNTRIES = LEAGUES.map(([code, name]) => ({ code, name: t(name) }));
export const CLUBS_PER_DIVISION = 12;
export const DIVISIONS = [t('I liga'), t('II liga'), t('III liga'), t('IV liga')];
export const ROMAN = ['I', 'II', 'III', 'IV'];
/** "<country> – <division>" label, e.g. for pickers and preset competitions. */
export const leagueLabel = (country: string, division: number) => [t('{0} – I liga', country), t('{0} – II liga', country), t('{0} – III liga', country), t('{0} – IV liga', country)][division - 1];

const PALETTE = ['#dc2626', '#2563eb', '#facc15', '#16a34a', '#f8fafc', '#111827', '#7c3aed', '#ea580c', '#0ea5e9', '#e11d48', '#15803d', '#1e3a8a', '#991b1b', '#60a5fa', '#f97316', '#0891b2'];
const KEEPERS = ['#22c55e', '#f97316', '#ec4899', '#facc15'];

function clubs(): TeamDef[] {
  return LEAGUES.flatMap(([cc, , pool, cities, nicks]) => {
    // Nicknames are shuffled once for the top two divisions and again for the lower two:
    // a nickname can repeat lower down, but always with a different city.
    const shuffled = (seed: string) => { const r = prng(hashId(seed)); return nicks.map((_, i) => [r(1000), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => nicks[i]); };
    const order = [...shuffled(cc), ...shuffled(`${cc}-lower`)];
    return cities.map((city, i): TeamDef => {
      const div = 1 + Math.floor(i / CLUBS_PER_DIVISION), id = `${cc}${div}-${i % CLUBS_PER_DIVISION}`, k12 = i % CLUBS_PER_DIVISION;
      const k = prng(hashId(id)), shirt = PALETTE[k(PALETTE.length)];
      let shorts = PALETTE[k(PALETTE.length)];
      if (shorts === shirt) shorts = shirt === '#f8fafc' ? '#111827' : '#f8fafc';
      const level = [9 - Math.floor((k12 * 5) / CLUBS_PER_DIVISION), 5 - Math.floor((k12 * 3) / CLUBS_PER_DIVISION), 3 - Math.floor((k12 * 2) / CLUBS_PER_DIVISION), 2 - Math.floor(k12 / 6)][div - 1];
      return {
        id, name: `${city} ${order[i]}`, short: city.replace(/[^A-Za-zÀ-ž]/g, '').slice(0, 3).toUpperCase(), national: false, country: cc, division: div, level,
        kits: [{ shirt, shorts }, { shirt: shorts, shorts: shirt }], keeper: KEEPERS[k(KEEPERS.length)], formation: k(FORMATIONS.length), players: makePlayers(id, level, pool),
      };
    });
  });
}

// Nations: code, Polish name (translated), short, region, level, shirt, shorts, name pool.
type NationRow = [string, string, string, 'eu' | 'world', number, string, string, string];
const NATION_ROWS: NationRow[] = [
  ['fr', 'Francja', 'FRA', 'eu', 9, '#1d4ed8', '#f8fafc', 'fr'], ['es', 'Hiszpania', 'ESP', 'eu', 9, '#dc2626', '#1d4ed8', 'es'],
  ['en', 'Anglia', 'ENG', 'eu', 8, '#f8fafc', '#1e3a8a', 'en'], ['de', 'Niemcy', 'GER', 'eu', 8, '#f8fafc', '#111827', 'de'],
  ['pt', 'Portugalia', 'POR', 'eu', 8, '#b91c1c', '#15803d', 'pt'], ['nl', 'Holandia', 'NED', 'eu', 8, '#f97316', '#f8fafc', 'nl'],
  ['it', 'Włochy', 'ITA', 'eu', 8, '#2563eb', '#f8fafc', 'it'], ['be', 'Belgia', 'BEL', 'eu', 7, '#b91c1c', '#111827', 'fr'],
  ['hr', 'Chorwacja', 'CRO', 'eu', 7, '#f8fafc', '#dc2626', 'pl'], ['dk', 'Dania', 'DEN', 'eu', 7, '#dc2626', '#f8fafc', 'sv'],
  ['ch', 'Szwajcaria', 'SUI', 'eu', 7, '#dc2626', '#f8fafc', 'de'], ['pl', 'Polska', 'POL', 'eu', 7, '#f8fafc', '#dc2626', 'pl'],
  ['at', 'Austria', 'AUT', 'eu', 6, '#dc2626', '#f8fafc', 'de'], ['ua', 'Ukraina', 'UKR', 'eu', 6, '#facc15', '#1d4ed8', 'pl'],
  ['rs', 'Serbia', 'SRB', 'eu', 6, '#b91c1c', '#1d4ed8', 'pl'], ['tr', 'Turcja', 'TUR', 'eu', 6, '#dc2626', '#f8fafc', 'tr'],
  ['se', 'Szwecja', 'SWE', 'eu', 6, '#facc15', '#1d4ed8', 'sv'], ['cz', 'Czechy', 'CZE', 'eu', 6, '#dc2626', '#f8fafc', 'pl'],
  ['no', 'Norwegia', 'NOR', 'eu', 6, '#dc2626', '#f8fafc', 'sv'], ['sc', 'Szkocja', 'SCO', 'eu', 5, '#1e3a8a', '#f8fafc', 'en'],
  ['hu', 'Węgry', 'HUN', 'eu', 5, '#dc2626', '#f8fafc', 'hu'], ['wa', 'Walia', 'WAL', 'eu', 5, '#dc2626', '#f8fafc', 'en'],
  ['ro', 'Rumunia', 'ROU', 'eu', 5, '#facc15', '#1d4ed8', 'ro'], ['gr', 'Grecja', 'GRE', 'eu', 5, '#f8fafc', '#1d4ed8', 'gr'],
  ['br', 'Brazylia', 'BRA', 'world', 9, '#facc15', '#1d4ed8', 'pt'], ['ar', 'Argentyna', 'ARG', 'world', 9, '#7dd3fc', '#111827', 'es'],
  ['uy', 'Urugwaj', 'URU', 'world', 7, '#38bdf8', '#111827', 'es'], ['co', 'Kolumbia', 'COL', 'world', 7, '#facc15', '#1d4ed8', 'es'],
  ['mx', 'Meksyk', 'MEX', 'world', 6, '#15803d', '#f8fafc', 'es'], ['us', 'USA', 'USA', 'world', 6, '#f8fafc', '#1e3a8a', 'en'],
  ['jp', 'Japonia', 'JPN', 'world', 7, '#1e3a8a', '#f8fafc', 'ja'], ['ma', 'Maroko', 'MAR', 'world', 7, '#b91c1c', '#15803d', 'ar'],
  ['sn', 'Senegal', 'SEN', 'world', 6, '#f8fafc', '#15803d', 'af'], ['kr', 'Korea Płd.', 'KOR', 'world', 6, '#dc2626', '#111827', 'ko'],
  ['au', 'Australia', 'AUS', 'world', 5, '#facc15', '#15803d', 'en'], ['ca', 'Kanada', 'CAN', 'world', 5, '#dc2626', '#f8fafc', 'en'],
  ['ng', 'Nigeria', 'NGA', 'world', 6, '#16a34a', '#f8fafc', 'af'], ['eg', 'Egipt', 'EGY', 'world', 5, '#dc2626', '#f8fafc', 'ar'],
  ['ir', 'Iran', 'IRN', 'world', 5, '#f8fafc', '#dc2626', 'ar'], ['sa', 'Arabia Saudyjska', 'KSA', 'world', 4, '#16a34a', '#f8fafc', 'ar'],
];

function nations(): TeamDef[] {
  return NATION_ROWS.map(([cc, name, short, region, level, shirt, shorts, pool]) => {
    const id = `n-${cc}`, k = prng(hashId(id));
    return {
      id, name: t(name), short, national: true, country: region, division: 0, level,
      kits: [{ shirt, shorts }, { shirt: shorts, shorts: shirt }], keeper: KEEPERS[k(KEEPERS.length)], formation: k(FORMATIONS.length), players: makePlayers(id, level, NATION_POOL[cc] ?? pool),
    };
  });
}

export const TEAMS: TeamDef[] = [...clubs(), ...nations()];
const BY_ID = new Map(TEAMS.map((x) => [x.id, x]));

/** Built-in team, or a user-edited copy if one is stored (see editors). */
export function team(id: string, custom: TeamDef[] = []): TeamDef {
  return custom.find((x) => x.id === id) ?? BY_ID.get(id) ?? TEAMS[0];
}

export const leagueTeams = (country: string, division: number) => TEAMS.filter((x) => !x.national && x.country === country && x.division === division);
export const nationTeams = (region?: 'eu' | 'world') => TEAMS.filter((x) => x.national && (!region || x.country === region));

export function rating(p: Skills): number {
  return p.pos === 0 ? p.gk : Math.round((p.pa + p.sh + p.he + p.ta + p.co + p.sp) / 6);
}
/** Sum of the best eleven ratings. */
export const strength = (x: TeamDef) => x.players.map(rating).sort((a, b) => b - a).slice(0, 11).reduce((a, r) => a + r, 0);
/** Strongest first. */
export const byStrength = (list: TeamDef[]) => [...list].sort((a, b) => strength(b) - strength(a) || a.id.localeCompare(b.id));

/** Market value in thousands, used by career transfers and wages. */
export function value(p: Skills): number {
  const r = p.pos === 0 ? p.gk : (p.pa + p.sh + p.he + p.ta + p.co + p.sp) / 6;
  return Math.round((15 + r * r * r * 6) / 10) * 10; // rating 5 ≈ 0.8 mln, 9 ≈ 4.4 mln
}

/** Second kit when the first kits are too alike. */
export function kitsFor(home: TeamDef, away: TeamDef): [Kit, Kit] {
  const a = home.kits[0], b = away.kits[0];
  return [a, a.shirt === b.shirt || a.shirt === b.shorts ? away.kits[1] : b];
}

/** Best eleven for a formation: fill each slot's line with the best free player of that line. */
export function pickLineup(players: Skills[], shape: number[][]): number[] {
  const free = new Set(players.map((_, i) => i));
  return shape.map((slot, i) => {
    const line = lineOf(slot, i);
    const pool = [...free].filter((n) => (line === 0) === (players[n].pos === 0));
    const best = pool.sort((a, b) => (players[b].pos === line ? 1 : 0) - (players[a].pos === line ? 1 : 0) || rating(players[b]) - rating(players[a]))[0] ?? [...free][0];
    free.delete(best);
    return best;
  });
}

/** Simulation setup for a team: its squad, chosen tactic and lineup (custom tactics appended after presets). */
export function teamSetup(x: TeamDef, opts: { tactic?: number; lineup?: number[]; custom?: number[][][] } = {}): TeamSetup {
  const tactics = [...FORMATIONS.map((f) => f.pos), ...(opts.custom ?? [])];
  const tactic = opts.tactic !== undefined && opts.tactic < tactics.length ? opts.tactic : x.formation; // a deleted custom tactic falls back
  return { squad: x.players.map(({ name: _, age: __, ...skills }) => skills), lineup: opts.lineup ?? pickLineup(x.players, tactics[tactic]), tactics, tactic };
}

const COLOR = /^#[0-9a-f]{6}$/i;
/** Validate a team received from another player; null when it is not a usable team. */
export function sanitizeTeam(x: unknown): TeamDef | null {
  const d = x as TeamDef;
  if (!d || typeof d !== 'object' || !Array.isArray(d.players) || d.players.length < 11 || d.players.length > 30) return null;
  const n = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : 0);
  const str = (v: unknown, len: number) => String(v ?? '').slice(0, len);
  const kit = (k: Kit | undefined): Kit => ({ shirt: COLOR.test(k?.shirt ?? '') ? k!.shirt : '#dc2626', shorts: COLOR.test(k?.shorts ?? '') ? k!.shorts : '#f8fafc' });
  const players = d.players.map((p) => ({ name: str(p?.name, 28) || '?', pos: n(p?.pos, 3), pa: n(p?.pa, 9), sh: n(p?.sh, 9), he: n(p?.he, 9), ta: n(p?.ta, 9), co: n(p?.co, 9), sp: n(p?.sp, 9), gk: n(p?.gk, 9), age: n(p?.age, 60) }));
  if (!players.some((p) => p.pos === 0)) return null;
  return {
    id: str(d.id, 20), name: str(d.name, 32) || '?', short: str(d.short, 3) || '???', national: !!d.national, country: str(d.country, 8), division: n(d.division, 2), level: n(d.level, 9),
    kits: [kit(d.kits?.[0]), kit(d.kits?.[1])], keeper: COLOR.test(d.keeper ?? '') ? d.keeper : '#22c55e', formation: n(d.formation, FORMATIONS.length - 1), players,
    sponsors: Array.isArray(d.sponsors) ? d.sponsors.slice(0, 3).map((x) => str(x, 24)) : [],
  };
}

/**
 * The match both online peers (and the server, to pay prize money) build from the server's
 * config: validated teams and settings, default lineups and preset tactics only.
 */
export function onlineMatch(c: Record<string, unknown>): { home: TeamDef; away: TeamDef; setup: MatchSetup } {
  const home = sanitizeTeam(c.home) ?? TEAMS[0], away = sanitizeTeam(c.away) ?? TEAMS[1];
  const minutes = MATCH_MINUTES.includes(c.minutes as number) ? (c.minutes as number) : MATCH_MINUTES[0];
  const pitch = Number.isInteger(c.pitch) && (c.pitch as number) >= 0 && (c.pitch as number) < 7 ? (c.pitch as number) : 4;
  return { home, away, setup: { teams: [teamSetup(home), teamSetup(away)], minutes, extraTime: c.extraTime === true, penalties: c.penalties === true, pitch } };
}
