import type { Config } from "drizzle-kit";

const requireEnv = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set - run \`pnpm setup:env\``);
  return v;
};

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: requireEnv("DATABASE_URL") },
} satisfies Config;
