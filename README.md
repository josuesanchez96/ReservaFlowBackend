# ReservaFlow – API de reservas con pruebas de rendimiento k6

API backend de reservas (Node.js 20 Express + TypeScript + PostgreSQL 16) diseñada para evaluar y comparar rendimiento con **k6**:

| Versión | Estado | Características |
|---|---|---|
| **v1** | Cuello de botella inyectado | Consulta N+1 en listado paginado + ausencia de índices B-Tree en tabla `reservations`. |
| **v2** | Optimizada | Consulta SQL con JOIN único + índices estratégicos aplicados mediante `v2_fix.sql`. |

---

## Estructura del Proyecto

```
docker-compose.yml        Orquestación de PostgreSQL 16 y la API
db/init.sql               Esquema inicial + ~290,000 registros ficticios (estado v1, sin índices)
db/v2_fix.sql             Parche de optimización (creación de índices B-Tree idempotentes)
app/                      Código de la API (src/server.ts, src/listing.ts, src/db.ts)
k6/                       Scripts de prueba (smoke.js, load.js, stress_recovery.js, lib.js)
PLAN_DE_PRUEBAS.md        Plan ejecutivo de pruebas
INFORME_HALLAZGO_Y_MEJORA.md Informe técnico final con métricas comparativas
```

---

## Endpoints Disponibles

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Chequeo de estado y versión activa (`v1` o `v2`). |
| `GET` | `/availability?resourceId=1&date=2026-12-01` | Capacidad y ocupación por franja horaria (9:00 a 20:00). |
| `POST` | `/reservations` | Crea reserva `{resourceId, customerName, date, slot, guests}`. Devuelve `201` si aprueba, `409` si supera el límite de 20 personas por franja, `400` si hay error de validación. |
| `GET` | `/reservations?page=1&pageSize=50&status=confirmed` | Listado paginado con ordenamiento cronológico. |

---

## Guía Rápida de Comandos (Reproducibles)

### 1. Iniciar con Docker (Versión v1 inicial)
Para levantar PostgreSQL y la API en segundo plano:

```powershell
# En PowerShell / CMD / Bash:
docker compose up -d
```
> *Nota:* Si es la primera vez que se construye la imagen o hubo cambios de código, puedes usar: `docker compose up -d --build`.  
> Verifica que el servicio esté respondiendo:
> ```powershell
> curl http://localhost:3000/health
> # Respuesta: {"status":"ok","version":"v1"}
> ```

---

### 2. Ejecutar los scripts de k6

Asegúrate de tener `k6` instalado en tu equipo (`winget install k6` o `choco install k6`).

#### A. Prueba de Humo (Smoke Test)
Verifica la funcionalidad básica y los códigos HTTP esperados (1 VU, 1 minuto):
```powershell
k6 run k6/smoke.js
```

#### B. Prueba de Carga Sostenida (Load Test)
Simula tráfico constante de 150 req/s durante 5 minutos con la mezcla 70% lectura / 30% escritura:
```powershell
k6 run k6/load.js
```
*(Opcional: guardar resultados para el informe)*:
```powershell
k6 run --summary-export=results/load_v1.json k6/load.js
```
> *Comportamiento esperado en v1:* Falla el umbral `p(95)<200` y registra `dropped_iterations` por saturación de VUs.

#### C. Prueba de Estrés y Recuperación (Stress & Recovery Test)
Sube progresivamente hasta 100 VUs, mantiene meseta y desciende a 10 VUs para medir resiliencia:
```powershell
k6 run k6/stress_recovery.js
```

---

### 3. Aplicar el parche v2_fix.sql y activar v2

Aplica los índices en PostgreSQL sin necesidad de reiniciar la base de datos y recrea la API en modo v2:

```powershell
# Paso 1: Aplicar índices en la base de datos
docker compose exec -T db psql -U reserva -d reservaflow -f /db/v2_fix.sql

# Paso 2: Cambiar la API a v2 y recrear el contenedor
$env:APP_VERSION = "v2"
docker compose up -d --force-recreate api
```

*(En Bash / Linux / macOS el paso 2 es: `APP_VERSION=v2 docker compose up -d --force-recreate api`)*

Verifica el cambio de versión:
```powershell
curl http://localhost:3000/health
# Respuesta: {"status":"ok","version":"v2"}
```

Ahora puedes repetir `k6 run k6/load.js` para observar todos los umbrales en verde y 0 iteraciones descartadas.

---

### 4. Restablecer la base de datos a su estado original

Para eliminar los datos insertados durante las pruebas, borrar los índices de v2 y volver a ejecutar la siembra limpia de `init.sql`:

```powershell
# Comando directo (PowerShell / Bash):
docker compose down -v && docker compose up -d
```

Si deseas asegurar que inicie explícitamente en `v1`:
```powershell
# PowerShell:
docker compose down -v
$env:APP_VERSION = "v1"
docker compose up -d
```

*(Alternativa rápida: si solo deseas limpiar los registros generados por k6 sin destruir el volumen ni los índices):*
```powershell
docker compose exec db psql -U reserva -d reservaflow -c "DELETE FROM reservations WHERE customer_name LIKE 'k6-user-%' OR customer_name = 'smoke-overbook';"
```

---

## Detener los Servicios

```powershell
# Detener contenedores conservando datos:
docker compose down

# Detener contenedores eliminando volúmenes de datos:
docker compose down -v
```
