import { Pool } from "pg";

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://reserva:reserva@localhost:5432/reservaflow",
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

