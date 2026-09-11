import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export * as schema from "./schema.ts";
export { eq, and, or, desc, asc, sql, inArray } from "drizzle-orm";

let pool: pg.Pool | undefined;

export const db = () => {
  pool ??= new pg.Pool({
    connectionString: process.env["DATABASE_URL"] ?? "postgres://charkha:charkha@localhost:5432/charkha",
    max: 10,
  });
  return drizzle(pool, { schema });
};

export type Db = ReturnType<typeof db>;
