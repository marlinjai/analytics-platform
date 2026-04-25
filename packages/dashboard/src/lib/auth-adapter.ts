import type { Adapter, AdapterUser, AdapterAccount } from 'next-auth/adapters';
import { getDb } from './db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(row: any): AdapterUser {
  return {
    id: row.id as string,
    email: row.email as string,
    name: (row.name as string) ?? null,
    image: (row.avatar_url as string) ?? null,
    emailVerified: null,
  };
}

export function createPostgresAdapter(): Adapter {
  return {
    async createUser(user) {
      const db = getDb();
      const rows = await db`
        INSERT INTO users (email, name, avatar_url)
        VALUES (${user.email}, ${user.name ?? null}, ${user.image ?? null})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
        RETURNING id, email, name, avatar_url
      `;
      return toUser(rows[0]);
    },

    async getUser(id) {
      const db = getDb();
      const rows = await db`SELECT id, email, name, avatar_url FROM users WHERE id = ${id}`;
      return rows[0] ? toUser(rows[0]) : null;
    },

    async getUserByEmail(email) {
      const db = getDb();
      const rows = await db`SELECT id, email, name, avatar_url FROM users WHERE email = ${email}`;
      return rows[0] ? toUser(rows[0]) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const db = getDb();
      const rows = await db`
        SELECT u.id, u.email, u.name, u.avatar_url
        FROM users u
        JOIN accounts a ON a."userId" = u.id
        WHERE a.provider = ${provider} AND a."providerAccountId" = ${providerAccountId}
      `;
      return rows[0] ? toUser(rows[0]) : null;
    },

    async linkAccount(account: AdapterAccount) {
      const db = getDb();
      await db.unsafe(
        `INSERT INTO accounts (
          "userId", type, provider, "providerAccountId",
          refresh_token, access_token, expires_at, token_type, scope, id_token, session_state
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING`,
        [
          account.userId,
          account.type,
          account.provider,
          account.providerAccountId,
          account.refresh_token ?? null,
          account.access_token ?? null,
          account.expires_at ?? null,
          account.token_type ?? null,
          account.scope ?? null,
          account.id_token ?? null,
          account.session_state ?? null,
        ],
      );
    },

    async updateUser(user) {
      const db = getDb();
      const rows = await db`
        UPDATE users SET name = ${user.name ?? null}, avatar_url = ${user.image ?? null}
        WHERE id = ${user.id}
        RETURNING id, email, name, avatar_url
      `;
      return toUser(rows[0]);
    },

    // Stubs — not called with JWT strategy
    async createSession() { return { sessionToken: '', userId: '', expires: new Date() }; },
    async getSessionAndUser() { return null; },
    async updateSession() { return null; },
    async deleteSession() {},
    async createVerificationToken(vt) { return vt; },
    async useVerificationToken() { return null; },
  };
}
