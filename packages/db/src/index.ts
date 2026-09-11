import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export * as schema from "./schema.ts";
export { eq, and, or, desc, asc, sql, inArray } from "drizzle-orm";

let pool: pg.Pool | undefined;

export const db = () => {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    // No fallback on purpose. Silently connecting to a guessed database is a
    // worse failure than refusing to start.
    throw new Error("DATABASE_URL is not set - run `pnpm setup:env`, then `docker compose up -d db`");
  }
  pool ??= new pg.Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
};

export type Db = ReturnType<typeof db>;
