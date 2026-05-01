import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "./env.js";
import * as schema from "../shared/schema.js";

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });
export { pool };

export async function ensureExtensions(): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
}
