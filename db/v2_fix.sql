-- =====================================================================
-- v2: corrección del cuello de botella (índices)
-- Aplicar con:
--   docker compose exec -T db psql -U reserva -d reservaflow -f /db/v2_fix.sql
-- (o ver README.md). Es idempotente.
-- =====================================================================

-- 1) Disponibilidad y control de sobre-reserva:
--    WHERE resource_id = ? AND reservation_date = ? [AND slot = ?] AND status = 'confirmed'
--    INCLUDE(guests) permite index-only scan en el SUM(guests).
CREATE INDEX IF NOT EXISTS idx_reservations_lookup
    ON reservations (resource_id, reservation_date, slot, status) INCLUDE (guests);

-- 2) Listado paginado: ORDER BY reservation_date DESC, id DESC con filtro opcional por status.
CREATE INDEX IF NOT EXISTS idx_reservations_status_date
    ON reservations (status, reservation_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_date
    ON reservations (reservation_date DESC, id DESC);

ANALYZE reservations;

