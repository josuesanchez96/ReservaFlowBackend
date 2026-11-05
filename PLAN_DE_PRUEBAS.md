# Plan de Pruebas de Rendimiento – ReservaFlow (Resumen Ejecutivo)

> **Objetivo:** Comparar la API v1 (con cuello de botella) vs v2 (optimizada) bajo tráfico sostenido de 150 req/s y validar su resiliencia bajo estrés y recuperación con k6.

---

## 1. Entorno y Hardware de Prueba

Todo el stack se ejecuta localmente en la misma máquina, compitiendo por CPU y RAM:

| Componente | Especificación |
|---|---|
| **Equipo** | Lenovo LOQ 15ARP9 |
| **CPU** | AMD Ryzen 5 7235HS @ 3.20 GHz (4 núcleos / 8 hilos lógicos) |
| **RAM** | 16.0 GB DDR5 (15.7 GB utilizable, 4800 MT/s) |
| **SO y Motor** | Windows 11 (x64) + Docker Desktop con backend WSL2 |
| **Stack SUT** | Node.js 20 LTS (Express, TypeScript) + PostgreSQL 16 Alpine (pool: 10 conexiones) |
| **Datos Iniciales** | 50 recursos y ~290,000 reservas en PostgreSQL |
| **Herramienta** | Grafana k6 v0.x local |

---

## 2. Demanda y Mezcla de Tráfico (70% Lectura / 30% Escritura)

- **Tasa objetivo:** **150 iteraciones/segundo** sostenidas durante 5 minutos (45,000 peticiones objetivo).
- **Modelo:** **Abierto (`constant-arrival-rate`)**. Desacopla la tasa de llegada de la latencia del servidor: si el backend se ralentiza, k6 sigue exigiendo 150 req/s, simulando tráfico real.
- **Tope de seguridad:** `maxVUs: 300` (pre-asignadas: 50). Protege la RAM (16 GB) y CPU (8 hilos) del host contra congelamientos, registrando la saturación como `dropped_iterations`.

### Distribución de endpoints
1. **40% `GET /availability` (Lectura):** Consulta de horarios libres por recurso/fecha. Ejecuta agregaciones `SUM(guests)`.
2. **30% `GET /reservations` (Lectura):** Listado paginado de 50 registros ordenados por fecha. Simula paneles de control.
3. **30% `POST /reservations` (Escritura):** Creación transaccional con bloqueo pesimista `FOR UPDATE` para garantizar capacidad $\le 20$ personas por franja.

---

## 3. Escenarios de Prueba

| Script | Perfil k6 | Duración | Objetivo |
|---|---|---|---|
| **`smoke.js`** | 1 VU constante | 1 min | Verificar sanidad operativa, respuestas 200/201, rechazo 400 y regla de no sobrecupo con 409. |
| **`load.js`** | 150 it/s (50 a 300 VUs) | 5 min | Medir latencias p(95)/p(99), throughput y dropped iterations bajo carga normal. |
| **`stress_recovery.js`** | 7 etapas (0 $\rightarrow$ 20 $\rightarrow$ 60 $\rightarrow$ 100 VUs $\rightarrow$ 10 VUs $\rightarrow$ 0) | 12 min | Estresar hasta 100 VUs (límite del hardware) y verificar si al bajar a 10 VUs el sistema se recupera. |

---

## 4. Criterios de Parada y Seguridad (`abortOnFail`)

En `stress_recovery.js`, si el servidor colapsa bajo 100 VUs, continuar inyectando carga podría congelar Windows o corromper Docker. Se configuran dos **disyuntores automáticos** (`delayAbortEval: 30s`):
1. **`http_req_failed` > 10%:** Cancela la prueba si la tasa de errores HTTP/conexión supera el 10%.
2. **`http_req_duration` p(99) > 5,000 ms:** Cancela la prueba si la latencia del 1% de peticiones excede 5 s (cola desbordada).

---

## 5. Umbrales de Aprobación (Thresholds)

### Carga Normal (`load.js`)
- `http_req_duration`: **p(95) < 200 ms**, **p(99) < 500 ms** *(global)*
- `http_req_duration{endpoint:availability}`: **p(95) < 150 ms**
- `http_req_duration{endpoint:list}`: **p(95) < 250 ms**
- `http_req_duration{endpoint:create}`: **p(95) < 250 ms**
- `http_req_failed`: **< 1.00%**
- `checks`: **> 99.00%**

### Estrés y Recuperación (`stress_recovery.js`)
- `http_req_failed`: **< 10%** *(crítico, aborta)*
- `http_req_duration`: **p(99) < 5,000 ms** *(crítico, aborta)*
- `http_req_duration{phase:recuperacion}`: **p(95) < 300 ms** *(criterio de resiliencia en baja carga post-estrés)*
- `http_req_failed{phase:recuperacion}`: **< 1%**

---

## 6. Procedimiento Rápido de Ejecución

```powershell
# 1. Iniciar v1 (con cuello de botella)
docker compose down -v
$env:APP_VERSION = "v1"; docker compose up -d --build

# 2. Ejecutar prueba de carga v1 (falla esperada: p(95) > 200ms y dropped_iterations > 0)
k6 run --summary-export=results/load_v1.json k6/load.js

# 3. Aplicar corrección v2 (índices SQL + cambio de versión)
docker compose exec -T db psql -U reserva -d reservaflow -f /db/v2_fix.sql
$env:APP_VERSION = "v2"; docker compose up -d --force-recreate api

# 4. Validar v2 (pasa todos los umbrales en verde y 0 dropped_iterations)
k6 run --summary-export=results/load_v2.json k6/load.js
k6 run --summary-export=results/stress_recovery_v2.json k6/stress_recovery.js
```

---

## 7. Criterios de Éxito
- **v1:** Evidencia clara del cuello de botella en `GET /reservations` ($p(95) \gg 200\text{ ms}$).
- **v2:** Cumple 100% de los umbrales de carga a 150 it/s sin descartar iteraciones.
- **Recuperación:** Retorna a latencias basales ($p(95) < 300\text{ ms}$) tras la etapa de estrés sin reinicio del contenedor.
- **Integridad:** Cero violaciones de sobreventa (409) ni errores 500 en ninguna versión.
