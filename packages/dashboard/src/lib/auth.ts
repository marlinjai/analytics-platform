import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import PostgresAdapter from '@auth/pg-adapter';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PostgresAdapter(getDb()),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
    Credentials({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            console.log('[auth] Missing email or password');
            return null;
          }

          console.log('[auth] Login attempt for:', credentials.email);
          const db = getDb();
          const [user] = await db`
            SELECT id, email, name, avatar_url, password_hash
            FROM users
            WHERE email = ${credentials.email as string}
          `;

          if (!user) {
            console.log('[auth] No user found for:', credentials.email);
            return null;
          }

          if (!user.password_hash) {
            console.log('[auth] User has no password_hash');
            return null;
          }

          console.log('[auth] User found, comparing password...');
          const valid = await bcrypt.compare(
            credentials.password as string,
            user.password_hash as string
          );
          console.log('[auth] Password valid:', valid);
          if (!valid) return null;

          return {
            id: user.id as string,
            email: user.email as string,
            name: (user.name as string) ?? null,
            image: (user.avatar_url as string) ?? null,
          };
        } catch (err) {
          console.error('[auth] Authorize error:', err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
