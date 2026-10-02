import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../src/hono/webs';
import jwtUtils from '../src/utils/jwt-utils';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=';
const appearance = { background: 'color', color: '#112233', surface: 'frosted', opacity: 0.85, blur: 18 };
const databases = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE user (user_id INTEGER PRIMARY KEY, email TEXT, type INTEGER, status INTEGER, is_del INTEGER);
    CREATE TABLE account (account_id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, name TEXT, is_del INTEGER);
    CREATE TABLE role (role_id INTEGER PRIMARY KEY);
    CREATE TABLE perm (perm_id INTEGER PRIMARY KEY, perm_key TEXT, type INTEGER);
    CREATE TABLE role_perm (id INTEGER PRIMARY KEY, role_id INTEGER, perm_id INTEGER);
    INSERT INTO user VALUES (1, 'root@example.com', 0, 0, 0), (2, 'user@example.com', 2, 0, 0), (3, 'other@example.com', 2, 0, 0), (4, 'manager@example.com', 3, 0, 0);
    INSERT INTO account VALUES (1, 2, 'user@example.com', 'Original sender', 0);
    INSERT INTO role VALUES (0), (2), (3);
    INSERT INTO perm VALUES (1, 'setting:set', 2);
    INSERT INTO role_perm VALUES (1, 3, 1);
  `);
  const migrationPath = 'migrations/001_ui_storage.sql';
  const migration = readFileSync(migrationPath, 'utf8');
  sqlite.exec(migration); sqlite.exec(migration);
  const db = {
    prepare(sql) {
      let params = [];
      const statement = () => sqlite.prepare(sql);
      const values = () => params.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      return {
        bind(...args) { params = args; return this; },
        async first(column) { const row = statement().get(...values()) ?? null; return column ? row?.[column] : row; },
        async all() { return { success: true, results: statement().all(...values()) }; },
        async raw() { return statement().all(...values()).map(row => Object.values(row)); },
        async run() { const result = statement().run(...values()); return { success: true, meta: { changes: result.changes } }; },
      };
    },
  };
  const auth = new Map();
  const env = {
    db, admin: 'root@example.com', jwt_secret: 'test-signing-secret',
    kv: {
      async get(key, options) { const value = auth.get(key); return options?.type === 'json' && value ? JSON.parse(value) : value ?? null; },
      async put(key, value) { auth.set(key, value); },
    },
  };
  const tokens = {};
  for (const user of sqlite.prepare('SELECT * FROM user').all()) {
    const uuid = `test-session-${user.user_id}`;
    auth.set(`auth-uid:${user.user_id}`, JSON.stringify({ tokens: [uuid], refreshTime: new Date().toISOString(), user: { userId: user.user_id, email: user.email } }));
    tokens[user.user_id] = await jwtUtils.generateToken({ env }, { userId: user.user_id, token: uuid }, 3600);
  }
  const call = (path, id, method = 'GET', body) => app.request(path, {
    method, headers: { ...(id ? { authorization: tokens[id] } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { call, sqlite, auth };
}

describe('backend UI storage with the existing JWT, KV and D1', () => {
  it('publishes appearance without exposing protected or similarly prefixed routes', async () => {
    const f = await fixture();
    expect((await f.call('/ui/appearance')).status).toBe(200);
    expect((await (await f.call('/ui/appearance')).json()).data).toMatchObject({ background: 'gradient', version: 0 });
    for (const [path, method] of [['/ui/profile', 'GET'], ['/ui/images/avatar', 'GET'], ['/ui/appearance/extra', 'GET'], ['/ui/appearance', 'PUT']]) {
      expect((await (await f.call(path, undefined, method, method === 'PUT' ? appearance : undefined)).json()).code).toBe(401);
    }
    expect((await f.call('/ui/images/background')).status).toBe(404);
  });

  it('persists only the authenticated user profile and serves its image privately', async () => {
    const f = await fixture();
    expect((await (await f.call('/ui/profile', 2)).json()).data).toMatchObject({ nickname: 'Original sender', version: 0 });
    const saved = await f.call('/ui/profile', 2, 'PUT', { userId: 3, nickname: ' New nickname ', avatar: png, version: 0 });
    expect(saved.status).toBe(200);
    expect((await saved.json()).data).toMatchObject({ nickname: 'New nickname', version: 1, avatar: '/api/ui/images/avatar?v=1' });
    expect((await (await f.call('/ui/profile', 3)).json()).data.nickname).toBe('other');
    expect((await f.call('/ui/images/avatar', 3)).status).toBe(404);
    const image = await f.call('/ui/images/avatar', 2);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(png.split(',')[1]);
    expect(f.sqlite.prepare('SELECT name FROM account WHERE account_id=1').get().name).toBe('Original sender');
    expect((await (await f.call('/ui/profile', 2)).json()).data.avatar).not.toContain('base64');
  });

  it('keeps an unchanged avatar, rejects simultaneous stale edits and supports removal', async () => {
    const f = await fixture();
    await f.call('/ui/profile', 2, 'PUT', { nickname: 'One', avatar: png, version: 0 });
    const edits = await Promise.all(['Two', 'Three'].map(nickname => f.call('/ui/profile', 2, 'PUT', { nickname, version: 1 })));
    expect(edits.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await f.call('/ui/images/avatar', 2)).status).toBe(200);
    expect((await f.call('/ui/profile', 2, 'PUT', { nickname: 'Removed', avatar: null, version: 2 })).status).toBe(200);
    expect((await f.call('/ui/images/avatar', 2)).status).toBe(404);
    expect((await f.call('/ui/profile', 3, 'PUT', { nickname: 'Missing', version: 10 })).status).toBe(409);
  });

  it('requires current setting permissions and publishes all saved appearance fields', async () => {
    const f = await fixture();
    expect((await f.call('/ui/appearance', 2, 'PUT', { ...appearance, version: 0 })).status).toBe(403);
    expect((await f.call('/ui/appearance', 4, 'PUT', { ...appearance, background: 'image', image: png, version: 0 })).status).toBe(200);
    const value = (await (await f.call('/ui/appearance')).json()).data;
    expect(value).toMatchObject({ ...appearance, background: 'image', image: '/api/ui/images/background?v=1', version: 1 });
    expect((await f.call('/ui/images/background')).headers.get('content-type')).toBe('image/png');
    expect((await f.call('/ui/appearance', 1, 'PUT', { ...appearance, version: 0 })).status).toBe(409);
    f.sqlite.exec('DELETE FROM role_perm');
    expect((await f.call('/ui/appearance', 4, 'PUT', { ...appearance, version: 1 })).status).toBe(403);
    expect((await f.call('/ui/appearance', 1, 'PUT', { ...appearance, version: 1 })).status).toBe(200);
    expect((await f.call('/ui/images/background')).status).toBe(404);
  });

  it('validates images, dimensions, body limits and versions before writing', async () => {
    const f = await fixture();
    const largeDimension = Buffer.from(png.split(',')[1], 'base64');
    largeDimension.writeUInt32BE(257, 16);
    for (const avatar of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/jpeg;base64,' + png.split(',')[1], 'data:image/png;base64,' + largeDimension.toString('base64'), 'data:image/png;base64,' + 'A'.repeat(180001)]) {
      expect((await f.call('/ui/profile', 2, 'PUT', { nickname: 'Invalid', avatar, version: 0 })).status).toBe(400);
    }
    for (const version of [-1, 0.1, '0', null]) {
      expect((await f.call('/ui/profile', 2, 'PUT', { nickname: 'Invalid', version })).status).toBe(400);
    }
    expect((await f.call('/ui/appearance', 1, 'PUT', { ...appearance, opacity: 0, version: 0 })).status).toBe(400);
    expect((await f.call('/ui/appearance', 1, 'PUT', { ...appearance, background: 'image', version: 0 })).status).toBe(400);
    expect((await f.call('/ui/profile', 2, 'PUT', { nickname: 'Invalid', junk: 'x'.repeat(1500000), version: 0 })).status).toBe(413);
    expect((await (await f.call('/ui/profile', 2)).json()).data.version).toBe(0);
  });

  it('preserves the published background while changing its surface settings', async () => {
    const f = await fixture();
    await f.call('/ui/appearance', 1, 'PUT', { ...appearance, background: 'image', image: png, version: 0 });
    const updated = await f.call('/ui/appearance', 1, 'PUT', { ...appearance, background: 'image', surface: 'transparent', version: 1 });
    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toMatchObject({ surface: 'transparent', image: '/api/ui/images/background?v=2', version: 2 });
    expect(Buffer.from(await (await f.call('/ui/images/background')).arrayBuffer()).toString('base64')).toBe(png.split(',')[1]);
  });

  it('honors upstream KV revocation and removes profiles when their D1 user is deleted', async () => {
    const f = await fixture();
    await f.call('/ui/profile', 2, 'PUT', { nickname: 'Saved', avatar: png, version: 0 });
    f.sqlite.exec('DELETE FROM user WHERE user_id = 2');
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM ui_profiles').get().n).toBe(0);
    expect((await f.call('/ui/profile', 2)).status).toBe(401);
    f.auth.delete('auth-uid:3');
    expect((await (await f.call('/ui/profile', 3)).json()).code).toBe(401);
  });
});
