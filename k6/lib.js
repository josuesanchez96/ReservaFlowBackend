// Utilidades compartidas por los scripts de k6 de ReservaFlow.
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// YYYY-MM-DD a "hoy + offset días" (UTC)
export function dateOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---- Lectura 1: disponibilidad (fechas sembradas: hoy-90 .. hoy+90) ----
export function getAvailability(tags = {}) {
  const url = `${BASE_URL}/availability?resourceId=${randInt(1, 50)}&date=${dateOffset(randInt(-90, 90))}`;
  const res = http.get(url, { tags: { endpoint: 'availability', ...tags } });
  check(res, {
    'availability: HTTP 200': (r) => r.status === 200,
    'availability: 12 franjas': (r) => r.status === 200 && r.json('slots').length === 12,
  });
  return res;
}

// ---- Lectura 2: listado paginado (páginas 1..20, filtro status=confirmed) ----
export function getList(tags = {}) {
  const url = `${BASE_URL}/reservations?page=${randInt(1, 20)}&pageSize=50&status=confirmed`;
  const res = http.get(url, { tags: { endpoint: 'list', ...tags } });
  check(res, {
    'list: HTTP 200': (r) => r.status === 200,
    'list: devuelve datos': (r) => {
      const body = r.json();
      return Array.isArray(body.data); // Acepta la estructura de arreglo válida
    },
  });
  return res;
}

// ---- Escritura: crear reserva en fechas NO sembradas (hoy+91 .. hoy+365) ----
// Así la carga de escritura no choca con la capacidad; los 409 se tratarían como fallo.
export function createReservation(tags = {}) {
  const payload = JSON.stringify({
    resourceId: randInt(1, 50),
    customerName: `k6-user-${__VU}-${__ITER}`,
    date: dateOffset(randInt(91, 365)),
    slot: randInt(9, 20),
    guests: randInt(1, 2),
  });
  const res = http.post(`${BASE_URL}/reservations`, payload, {
    ...JSON_HEADERS,
    tags: { endpoint: 'create', ...tags },
  });
  check(res, {
    'create: HTTP 201': (r) => r.status === 201,
    'create: devuelve id': (r) => r.status === 201 && r.json('id') !== undefined,
  });
  return res;
}

// Mezcla de tráfico 70% lectura (40% disponibilidad + 30% listado) / 30% escritura.
export function mixedTraffic(tags = {}) {
  const p = Math.random();
  if (p < 0.4) return getAvailability(tags);
  if (p < 0.7) return getList(tags);
  return createReservation(tags);
}

