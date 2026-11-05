/**
 * SMOKE TEST - verifica que el sistema funciona (1 VU, 1 minuto).
 *
 * Ejecutar:  k6 run k6/smoke.js        (BASE_URL=http://host:3000 opcional)
 *
 * Valida: salud, los 3 endpoints, la regla de negocio de no sobre-reservar (409)
 * y las validaciones (400). Umbrales laxos: solo busca detectar roturas, no medir rendimiento.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, getAvailability, getList, createReservation, dateOffset } from './lib.js';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],      // 409/400 esperados se declaran como no-fallos abajo
    checks: ['rate==1.0'],               // todos los checks funcionales deben pasar
    http_req_duration: ['p(95)<2000'],   // laxo: incluso v1 debe pasar el smoke
  },
};

// Respuestas 400/409 son esperadas en las pruebas negativas: no cuentan como http_req_failed.
const expected = http.expectedStatuses({ min: 200, max: 299 }, 400, 409);

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health: HTTP 200': (r) => r.status === 200 });

  getAvailability();
  getList();
  createReservation();

  // Regla de negocio: pedir más invitados que la capacidad (20) debe devolver 409.
  const over = http.post(
    `${BASE_URL}/reservations`,
    JSON.stringify({ resourceId: 1, customerName: 'smoke-overbook', date: dateOffset(400), slot: 10, guests: 21 }),
    { headers: { 'Content-Type': 'application/json' }, responseCallback: expected },
  );
  check(over, { 'overbooking rechazado con 409': (r) => r.status === 409 });

  // Validación de entrada: payload inválido debe devolver 400.
  const bad = http.post(`${BASE_URL}/reservations`, JSON.stringify({ foo: 'bar' }), {
    headers: { 'Content-Type': 'application/json' },
    responseCallback: expected,
  });
  check(bad, { 'payload inválido rechazado con 400': (r) => r.status === 400 });

  sleep(1);
}

