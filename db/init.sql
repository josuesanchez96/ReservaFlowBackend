-- =====================================================================
-- ReservaFlow - Inicialización de la base de datos (estado ORIGINAL / v1)
-- ---------------------------------------------------------------------
-- Se ejecuta automáticamente la primera vez que arranca el contenedor
-- de PostgreSQL (docker-entrypoint-initdb.d).
--
-- ATENCIÓN (cuello de botella intencional v1):
--   Solo existen las claves primarias. NO hay índices sobre
--   (resource_id, reservation_date, slot), ni sobre status/reservation_date.
--   El índice de corrección se aplica con db/v2_fix.sql.
-- =====================================================================

CREATE TABLE resources (
    id        SERIAL PRIMARY KEY,
    name      TEXT    NOT NULL,
    capacity  INTEGER NOT NULL CHECK (capacity > 0)   -- personas por franja
);

CREATE TABLE reservations (
    id               BIGSERIAL PRIMARY KEY,
    resource_id      INTEGER     NOT NULL REFERENCES resources(id),
    customer_name    TEXT        NOT NULL,
    reservation_date DATE        NOT NULL,
    slot             SMALLINT    NOT NULL CHECK (slot BETWEEN 9 AND 20), -- hora de inicio
    guests           SMALLINT    NOT NULL CHECK (guests > 0),
    status           TEXT        NOT NULL CHECK (status IN ('confirmed','pending','cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 50 recursos (mesas/salas) con capacidad de 20 personas por franja.
INSERT INTO resources (name, capacity)
SELECT 'Recurso ' || lpad(g::text, 2, '0'), 20
FROM generate_series(1, 50) g;

-- ~290,000 reservas ficticias (reproducibles gracias a setseed).
-- Rango de fechas sembradas: hoy-90 .. hoy+90 días.
-- Máximo 3 filas por (recurso, fecha, franja) con <=4 invitados => <=12 <= 20,
-- por lo que nunca se parte de un estado sobre-reservado.
SELECT setseed(0.42);

INSERT INTO reservations (resource_id, customer_name, reservation_date, slot, guests, status, created_at)
SELECT r.id,
       'Cliente ' || (floor(random() * 5000))::int,
       current_date + d,
       s,
       1 + floor(random() * 4)::int,
       CASE WHEN x < 0.70 THEN 'confirmed' WHEN x < 0.90 THEN 'cancelled' ELSE 'pending' END,
       now() - (random() * interval '120 days')
FROM resources r
CROSS JOIN generate_series(-90, 90) d
CROSS JOIN generate_series(9, 20) s
CROSS JOIN generate_series(1, 3) k
CROSS JOIN LATERAL (SELECT random() AS x, random() AS keep) rnd
WHERE rnd.keep < 0.89;

ANALYZE;

