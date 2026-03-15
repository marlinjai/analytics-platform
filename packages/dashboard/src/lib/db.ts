import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL environment variable is required');
    sql = postgres(url, { max: 10 });
  }
  return sql;
}
