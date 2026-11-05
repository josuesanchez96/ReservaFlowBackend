/**
 * LOAD TEST - carga sostenida con tráfico normal.
 *
 * Ejecutar:  k6 run k6/load.js
 *            k6 run --summary-export=results/load_v1.json k6/load.js
 *
 * Modelo abierto (constant-arrival-rate): 150 iteraciones/s durante 5 min
 * (50 a 300 VUs). Cada iteración es una petición:
 *   40% disponibilidad + 30% listado (70% lectura)  |  30% creación (escritura).
 * Se usa un modelo abierto para que la latencia alta NO reduzca la presión
 * ofrecida (en un modelo cerrado el servidor "frenaría" a k6 y ocultaría el problema).
 *
 * Esperado:  v1 -> FALLA p(95)<200 (listado N+1 + sin índices)
 *            v2 -> PASA todos los umbrales
 */
import { sleep } from 'k6';
import { mixedTraffic } from './lib.js';

export const options = {
  scenarios: {
    trafico_normal: {
      executor: 'constant-arrival-rate',
      rate: 150,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Umbrales por endpoint (sub-métricas con tags):
    'http_req_duration{endpoint:availability}': ['p(95)<150'],
    'http_req_duration{endpoint:list}': ['p(95)<250'],
    'http_req_duration{endpoint:create}': ['p(95)<250'],
  },
};

export default function () {
  mixedTraffic();
}

