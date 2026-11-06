// Administration (website admin.html): accounts and their e-mails, bans, adding and deleting
// users. Only for administrators named by e-mail in ADMIN_EMAILS (see accounts.ts isAdmin).
import type { DatabaseSync } from 'node:sqlite';
import type { Ctx, Route } from './accounts.ts';

export interface Online { online: number; playing: number; waiting: number; watching: number; matches: number }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function admin(db: DatabaseSync, isAdmin: (id: number) => boolean, online: () => Online): Route {
  const list = (search: string) => {
    const like = `%${search.toLowerCase()}%`;
    const users = db.prepare(`SELECT u.id, u.name, u.email, u.avatar, u.created, u.banned, u.coins,
        (SELECT team FROM clubs WHERE owner_id = u.id) AS team,
        (SELECT MAX(created) FROM sessions WHERE user_id = u.id) AS seen
      FROM users u
      WHERE ? = '%%' OR lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND lower(i.email) LIKE ?)
      ORDER BY u.id DESC LIMIT 500`).all(like, like, like, like) as { id: number; banned: number; team: string | null }[];
    const ids = db.prepare('SELECT provider, email, created FROM identities WHERE user_id = ? ORDER BY created');
    return users.map(({ team, ...u }) => ({
      ...u, banned: u.banned === 1, club: team ? String(JSON.parse(team).name ?? '') : null,
      identities: ids.all(u.id), admin: isAdmin(u.id),
    }));
  };
  const exists = (id: number) => !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);

  return async (c: Ctx) => {
    if (!c.path.startsWith('/admin/')) return false;
    if (!c.user) { c.send(401, { error: 'signed-out' }); return true; }
    if (!isAdmin(c.user.id)) { c.send(403, { error: 'not-admin' }); return true; }
    const { path, method, send } = c;
    let m: RegExpMatchArray | null;

    if (path === '/admin/stats' && method === 'GET') {
      const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      send(200, { ...online(), users: n('SELECT COUNT(*) AS n FROM users'), banned: n('SELECT COUNT(*) AS n FROM users WHERE banned = 1'), clubs: n('SELECT COUNT(*) AS n FROM clubs WHERE owner_id IS NOT NULL') });
    }
    else if (path === '/admin/users' && method === 'GET') send(200, list(c.url.searchParams.get('q')?.trim() ?? ''));
    else if (path === '/admin/emails' && method === 'GET') {
      // every distinct address: the account's own and those of its sign-ins
      send(200, db.prepare(`SELECT email, MIN(user_id) AS user FROM (SELECT email, id AS user_id FROM users UNION SELECT email, user_id FROM identities)
        WHERE email != '' GROUP BY lower(email) ORDER BY lower(email)`).all());
    }
    // A new account by e-mail: it is taken over at the first sign-in (Google/GitHub) with that address.
    else if (path === '/admin/users' && method === 'POST') {
      const b = await c.body();
      const name = String(b.name ?? '').trim(), email = String(b.email ?? '').trim();
      if (!name || name.length > 40) { send(400, { error: 'name' }); return true; }
      if (!EMAIL.test(email)) { send(400, { error: 'email' }); return true; }
      if (db.prepare('SELECT 1 FROM users u WHERE lower(email) = lower(?) UNION SELECT 1 FROM identities WHERE lower(email) = lower(?)').get(email, email)) { send(409, { error: 'exists' }); return true; }
      const id = Number(db.prepare('INSERT INTO users (name, email, avatar, created) VALUES (?, ?, \'\', ?)').run(name, email, Date.now()).lastInsertRowid);
      send(200, list('').find((u) => u.id === id));
    }
    else if ((m = path.match(/^\/admin\/users\/(\d+)\/ban$/)) && method === 'POST') {
      const id = Number(m[1]), banned = (await c.body()).banned !== false;
      if (!exists(id)) { send(404, { error: 'not-found' }); return true; }
      if (id === c.user.id) { send(409, { error: 'self' }); return true; }
      db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, id);
      if (banned) { // signed out everywhere, the app too
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM app_codes WHERE user_id = ?').run(id);
      }
      send(200, { ok: true, banned });
    }
    else if ((m = path.match(/^\/admin\/users\/(\d+)$/)) && method === 'DELETE') {
      const id = Number(m[1]);
      if (!exists(id)) { send(404, { error: 'not-found' }); return true; }
      if (id === c.user.id) { send(409, { error: 'self' }); return true; }
      db.prepare('DELETE FROM users WHERE id = ?').run(id); // like "delete my account": the club goes back to the computer
      send(200, { ok: true });
    }
    else send(404, { error: 'not-found' });
    return true;
  };
}
