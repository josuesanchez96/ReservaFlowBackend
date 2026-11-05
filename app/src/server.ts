import express, { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { listV1, listV2 } from "./listing";

const VERSION = (process.env.APP_VERSION ?? "v1").toLowerCase();
const list = VERSION === "v2" ? listV2 : listV1;
const SLOT_MIN = 9;
const SLOT_MAX = 20;

const app = express();
app.use(express.json());

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const toInt = (v: unknown): number => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: VERSION });
});

/**
 * GET /availability?resourceId=1&date=2026-12-01
 * Devuelve la capacidad restante por franja horaria (9..20).
 */
app.get("/availability", async (req, res, next) => {
  try {
    const resourceId = toInt(req.query.resourceId);
    const date = req.query.date;
    if (!Number.isInteger(resourceId) || !isDate(date)) {
      return res.status(400).json({ error: "resourceId (int) y date (YYYY-MM-DD) son obligatorios" });
    }
    const r = await pool.query("SELECT capacity FROM resources WHERE id = $1", [resourceId]);
    if (r.rowCount === 0) return res.status(404).json({ error: "recurso no encontrado" });
    const capacity: number = r.rows[0].capacity;

    const { rows } = await pool.query(
      `SELECT slot, COALESCE(SUM(guests), 0)::int AS booked
         FROM reservations
        WHERE resource_id = $1 AND reservation_date = $2 AND status = 'confirmed'
        GROUP BY slot`,
      [resourceId, date],
    );
    const booked = new Map<number, number>(rows.map((x) => [x.slot, x.booked]));
    const slots = [];
    for (let s = SLOT_MIN; s <= SLOT_MAX; s++) {
      const b = booked.get(s) ?? 0;
      slots.push({ slot: s, capacity, booked: b, available: Math.max(capacity - b, 0) });
    }
    res.json({ resourceId, date, slots });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /reservations  { resourceId, customerName, date, slot, guests }
 * Regla de negocio: la suma de invitados 'confirmed' por (recurso, fecha, franja)
 * no puede superar la capacidad del recurso => 409 si se sobre-reserva.
 * La fila del recurso se bloquea (FOR UPDATE) para serializar reservas concurrentes
 * sobre el mismo recurso y evitar condiciones de carrera.
 */
app.post("/reservations", async (req, res, next) => {
  const { resourceId, customerName, date, slot, guests } = req.body ?? {};
  if (
    !Number.isInteger(resourceId) ||
    typeof customerName !== "string" || customerName.trim() === "" ||
    !isDate(date) ||
    !Number.isInteger(slot) || slot < SLOT_MIN || slot > SLOT_MAX ||
    !Number.isInteger(guests) || guests < 1
  ) {
    return res.status(400).json({
      error: `Campos requeridos: resourceId, customerName, date (YYYY-MM-DD), slot (${SLOT_MIN}-${SLOT_MAX}), guests (>=1)`,
    });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT capacity FROM resources WHERE id = $1 FOR UPDATE", [resourceId]);
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "recurso no encontrado" });
    }
    const capacity: number = r.rows[0].capacity;
    const used = await client.query(
      `SELECT COALESCE(SUM(guests), 0)::int AS booked
         FROM reservations
        WHERE resource_id = $1 AND reservation_date = $2 AND slot = $3 AND status = 'confirmed'`,
      [resourceId, date, slot],
    );
    const booked: number = used.rows[0].booked;
    if (booked + guests > capacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "capacidad excedida", capacity, booked, requested: guests });
    }
    const ins = await client.query(
      `INSERT INTO reservations (resource_id, customer_name, reservation_date, slot, guests, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')
       RETURNING id, resource_id, customer_name, reservation_date, slot, guests, status, created_at`,
      [resourceId, customerName.trim(), date, slot, guests],
    );
    await client.query("COMMIT");
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(e);
  } finally {
    client.release();
  }
});

/**
 * GET /reservations?page=1&pageSize=20&status=confirmed
 * Listado paginado (más recientes por fecha de reserva primero).
 */
app.get("/reservations", async (req, res, next) => {
  try {
    const page = req.query.page === undefined ? 1 : toInt(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 20 : toInt(req.query.pageSize);
    const status = req.query.status as string | undefined;
    if (!(page >= 1) || !(pageSize >= 1 && pageSize <= 100)) {
      return res.status(400).json({ error: "page >= 1 y 1 <= pageSize <= 100" });
    }
    if (status !== undefined && !["confirmed", "pending", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "status inválido" });
    }
    res.json(await list({ page, pageSize, status }));
  } catch (e) {
    next(e);
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "error interno" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`ReservaFlow API ${VERSION} escuchando en :${port}`));

