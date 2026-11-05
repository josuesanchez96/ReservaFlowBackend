import { pool } from "./db";

export interface ListParams {
  page: number;
  pageSize: number;
  status?: string;
}

export interface ListResult {
  data: Record<string, unknown>[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

/**
 * v1 (CON CUELLO DE BOTELLA).
 *  - Consulta N+1: 1 query para la página + 1 query por cada fila para traer el recurso.
 *  - Sin índice sobre (status, reservation_date): ORDER BY ... DESC sobre ~290k filas
 *    implica Seq Scan + Sort en cada petición.
 */
export async function listV1({ page, pageSize, status }: ListParams): Promise<ListResult> {
  const params: unknown[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  params.push(pageSize + 1, (page - 1) * pageSize);
  const { rows } = await pool.query(
    `SELECT id, resource_id, customer_name, reservation_date, slot, guests, status, created_at
       FROM reservations ${where}
      ORDER BY reservation_date DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const hasNext = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);

  // N+1: una consulta por reserva
  const data = [];
  for (const r of pageRows) {
    const res = await pool.query("SELECT name FROM resources WHERE id = $1", [r.resource_id]);
    data.push({ ...r, resource_name: res.rows[0]?.name ?? null });
  }
  return { data, page, pageSize, hasNext };
}

/**
 * v2 (CORREGIDA).
 *  - Una sola consulta con JOIN (elimina el N+1).
 *  - Aprovecha idx_reservations_status_date / idx_reservations_date (db/v2_fix.sql)
 *    para leer en orden y detenerse en LIMIT sin ordenar toda la tabla.
 */
export async function listV2({ page, pageSize, status }: ListParams): Promise<ListResult> {
  const params: unknown[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE r.status = $${params.length}`;
  }
  params.push(pageSize + 1, (page - 1) * pageSize);
  const { rows } = await pool.query(
    `SELECT r.id, r.resource_id, rs.name AS resource_name, r.customer_name,
            r.reservation_date, r.slot, r.guests, r.status, r.created_at
       FROM reservations r
       JOIN resources rs ON rs.id = r.resource_id
       ${where}
      ORDER BY r.reservation_date DESC, r.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const hasNext = rows.length > pageSize;
  return { data: rows.slice(0, pageSize), page, pageSize, hasNext };
}

