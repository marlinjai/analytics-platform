// auth-adapter.ts — obsolete. NextAuth and its Postgres adapter are no longer
// used. Auth is handled by auth-brain. This file is kept to avoid breaking any
// import that has not been cleaned up yet; it exports a no-op stub.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPostgresAdapter(): any {
  return {};
}
