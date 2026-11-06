// Prometheus metrics (text exposition format, no client library): GET /metrics on the API.
// Gauges about accounts, clubs and coins are read from SQLite at scrape time (a few cheap
// COUNT/SUM queries); match and connection counters live in memory and restart from zero
// with the process, which Prometheus' rate()/increase() handle.
import type { DatabaseSync } from 'node:sqlite';
import type { Online } from './admin.ts';

type Labels = Record<string, string>;
const DAY = 864e5;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const key = (l: Labels) => { const e = Object.entries(l); return e.length ? `{${e.map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : ''; };

/** In-memory counters: kickabout_<name>_total{labels}. */
export class Counters {
  private v = new Map<string, Map<string, number>>();
  private help = new Map<string, string>();
  define(name: string, help: string) { this.help.set(name, help); this.v.set(name, new Map()); }
  inc(name: string, labels: Labels = {}, by = 1) {
    const m = this.v.get(name)!, k = key(labels);
    m.set(k, (m.get(k) ?? 0) + by);
  }
  text() {
    return [...this.v].map(([n, m]) => [`# HELP kickabout_${n}_total ${this.help.get(n)}`, `# TYPE kickabout_${n}_total counter`,
      ...(m.size ? [...m].map(([k, v]) => `kickabout_${n}_total${k} ${v}`) : [`kickabout_${n}_total 0`])].join('\n')).join('\n');
  }
}

export function metrics(db: DatabaseSync, online: () => Online, counters: Counters, version: string) {
  const started = Date.now();
  const one = (sql: string, ...a: number[]) => Number((db.prepare(sql).get(...a) as { n: number | null }).n ?? 0);
  const rows = (sql: string) => db.prepare(sql).all() as { k: string; n: number; s?: number }[];

  return (): string => {
    const now = Date.now(), out: string[] = [];
    const gauge = (name: string, help: string, values: [Labels, number][]) => {
      out.push(`# HELP kickabout_${name} ${help}`, `# TYPE kickabout_${name} gauge`, ...values.map(([l, v]) => `kickabout_${name}${key(l)} ${v}`));
    };
    const periods = (sql: string) => (['1d', '7d', '30d'] as const).map((p): [Labels, number] => [{ period: p }, one(sql, now - parseInt(p) * DAY)]);

    gauge('info', 'Running version.', [[{ version }, 1]]);
    const o = online();
    gauge('online', 'Connected to the match server now, by activity.', [[{ activity: 'playing' }, o.playing], [{ activity: 'waiting' }, o.waiting], [{ activity: 'watching' }, o.watching]]);
    gauge('live_matches', 'Online matches being played now.', [[{}, o.matches]]);

    gauge('users', 'Accounts.', [[{}, one('SELECT COUNT(*) AS n FROM users')]]);
    gauge('users_banned', 'Blocked accounts.', [[{}, one('SELECT COUNT(*) AS n FROM users WHERE banned = 1')]]);
    gauge('users_invited', 'Accounts added by an administrator, not signed in yet.', [[{}, one('SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id)')]]);
    gauge('users_active', 'Accounts seen (website, app or online club) within the period.', periods('SELECT COUNT(*) AS n FROM users WHERE seen >= ?'));
    gauge('users_registered', 'Accounts created within the period.', periods('SELECT COUNT(*) AS n FROM users WHERE created >= ?'));
    gauge('identities', 'Sign-in methods linked, by provider.', rows('SELECT provider AS k, COUNT(*) AS n FROM identities GROUP BY provider').map((r) => [{ provider: r.k }, r.n]));
    gauge('sessions', 'Valid sessions (website and app).', [[{}, one('SELECT COUNT(*) AS n FROM sessions WHERE expires > ?', now)]]);

    const owned = one('SELECT COUNT(*) AS n FROM clubs WHERE owner_id IS NOT NULL'), custom = one('SELECT COUNT(*) AS n FROM clubs WHERE owner_id IS NOT NULL AND custom = 1');
    gauge('clubs_owned', 'Clubs managed by players: founded or bought.', [[{ origin: 'founded' }, custom], [{ origin: 'bought' }, owned - custom]]);
    gauge('clubs_active', 'Player clubs active within the period.', periods('SELECT COUNT(*) AS n FROM clubs WHERE owner_id IS NOT NULL AND active >= ?'));
    gauge('coins', 'Coins in all wallets.', [[{}, one('SELECT SUM(coins) AS n FROM users')]]);
    gauge('ledger_coins', 'Coins moved, by kind (sum of ledger entries; negative = spent).', rows('SELECT kind AS k, COUNT(*) AS n, SUM(amount) AS s FROM ledger GROUP BY kind').map((r) => [{ kind: r.k }, r.s ?? 0]));
    gauge('ledger_entries', 'Ledger entries, by kind.', rows('SELECT kind AS k, COUNT(*) AS n FROM ledger GROUP BY kind').map((r) => [{ kind: r.k }, r.n]));
    gauge('offers', 'Offers between players, by status.', rows('SELECT status AS k, COUNT(*) AS n FROM offers GROUP BY status').map((r) => [{ status: r.k }, r.n]));
    gauge('sponsor_coins', 'Coins given to clubs by sponsors.', [[{}, one('SELECT SUM(amount) AS n FROM sponsors')]]);
    gauge('cpu_matches', 'Prize matches against the computer, by state.', [[{ state: 'verified' }, one('SELECT COUNT(*) AS n FROM cpu_matches WHERE done = 1')], [{ state: 'open' }, one('SELECT COUNT(*) AS n FROM cpu_matches WHERE done = 0')]]);

    out.push(counters.text());

    const mem = process.memoryUsage();
    out.push('# TYPE process_start_time_seconds gauge', `process_start_time_seconds ${Math.floor(started / 1000)}`,
      '# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${mem.rss}`,
      '# TYPE nodejs_heap_used_bytes gauge', `nodejs_heap_used_bytes ${mem.heapUsed}`,
      '# TYPE process_cpu_seconds_total counter', `process_cpu_seconds_total ${(process.cpuUsage().user + process.cpuUsage().system) / 1e6}`);
    return out.join('\n') + '\n';
  };
}
