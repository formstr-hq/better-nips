import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDatabasePool(connectionString: string) {
  if (!connectionString) throw new Error("A PostgreSQL connection string is required");
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

export function createDatabase(connectionString: string) {
  return createDatabasePool(connectionString).db;
}

export type Database = ReturnType<typeof createDatabase>;
export { schema };
