/**
 * STRESS + RECOVERY - estrés progresivo, meseta y recuperación.
 *
 * Ejecutar:  k6 run k6/stress_recovery.js
 *
 * Etapas (VUs, modelo cerrado con think time de 0.2-0.5 s):
 *   0:00-1:00  calentamiento      0 -> 20 VUs
 *   1:00-3:00  escalada          20 -> 60 VUs
 *   3:00-5:00  escalada          60 -> 100 VUs   (límite seguro del hardware de referencia)
 *   5:00-8:00  meseta               100 VUs
 *   8:00-8:30  descenso rápido  100 -> 10 VUs
 *   8:30-11:30 RECUPERACIÓN          10 VUs     (carga baja; ¿vuelve la latencia a la normalidad?)
 *   11:30-12:00 cierre            10 -> 0 VUs
 *
 * Las peticiones se etiquetan con phase=(subida|meseta|recuperacion) para comparar
 * la latencia en cada fase en los resultados.
 *
 * Umbrales de seguridad con abortOnFail: si el servidor colapsa (errores >10% o p(99)>5 s)
 * la prueba se aborta tras 30 s de evaluación para no destruir la máquina.
 */
import exec from 'k6/execution';
import { sleep } from 'k6';
import { mixedTraffic } from './lib.js';

export const options = {
  scenarios: {
    estres: {
      executor: 'ramping-vus',
      startVUs: 0,
      gracefulRampDown: '15s',
      stages: [
        { duration: '1m', target: 20 },
        { duration: '2m', target: 60 },
        { duration: '2m', target: 100 },
        { duration: '3m', target: 100 },
        { duration: '30s', target: 10 },
        { duration: '3m', target: 10 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // CRÍTICOS (abortan la prueba)
    http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(99)<5000', abortOnFail: true, delayAbortEval: '30s' }],
    // Criterio de recuperación: con carga baja el sistema debe volver a ser rápido
    'http_req_duration{phase:recuperacion}': ['p(95)<300'],
    'http_req_failed{phase:recuperacion}': ['rate<0.01'],
    checks: ['rate>0.95'],
  },
};

// Fase actual según el tiempo transcurrido desde el inicio del escenario (segundos).
function phase() {
  const t = (Date.now() - exec.scenario.startTime) / 1000;
  if (t < 300) return 'subida';
  if (t < 480) return 'meseta';
  if (t < 510) return 'descenso';
  return 'recuperacion';
}

export default function () {
  mixedTraffic({ phase: phase() });
  sleep(0.2 + Math.random() * 0.3);
}

