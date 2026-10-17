# Solución Inteligente Multimodal de Movilidad y Localización de Servicios Urbanos

Aplicación web que recibe una necesidad urbana (texto, imagen opcional y tres ubicaciones: novedad, punto de partida y destino), la analiza con IA, la deriva a la entidad responsable con datos propios, calcula rutas con servicios externos de mapas y deja trazabilidad completa del proceso. Un chat contextual permite hacer preguntas y ejecutar acciones sobre el caso.

## Tabla de contenido
1. [Arquitectura](#arquitectura)
2. [Agentes y orquestación](#agentes-y-orquestación)
3. [Herramientas y acciones](#herramientas-y-acciones)
4. [Persistencia y trazabilidad](#persistencia-y-trazabilidad)
5. [Flujo de un caso](#flujo-de-un-caso)
6. [Tecnologías](#tecnologías)
7. [Estructura del repositorio](#estructura-del-repositorio)
8. [Instalación y ejecución](#instalación-y-ejecución)
9. [Variables de entorno](#variables-de-entorno)
10. [API](#api)
11. [Limitaciones conocidas](#limitaciones-conocidas)

## Arquitectura

```
┌──────────────────────┐   JSON    ┌───────────────────────────────────────────┐
│ Interfaz web         │ ────────► │ Backend Express (index.js)                │
│ React + Vite + TS    │ ◄──────── │                                           │
│ Formulario, mapa     │           │  Orquestador (agents/orchestrator.js)     │
│ Leaflet, chat        │           │   ├─ Agente 1 Analista ──► Gemini         │
└──────────────────────┘           │   ├─ Agente 2 Ubicación ─► Datos propios  │
                                   │   │                      └► Nominatim/    │
                                   │   │                         Overpass (OSM)│
                                   │   └─ Agente 3 Rutas ─────► OSRM           │
                                   │                                           │
                                   │  Agente 4 Chat (function calling Gemini)  │
                                   │   └─ 4 herramientas (datos, mapas, acción)│
                                   │                                           │
                                   │  SQLite: casos, trazabilidad, caché       │
                                   └───────────────────────────────────────────┘
```

| Componente | Implementación |
|---|---|
| Interfaz web | React + Vite + TypeScript, mapa Leaflet con la ruta, chat y trazabilidad |
| Backend | Node.js + Express |
| Modelo de IA | Google Gemini (análisis multimodal y function calling), con respaldo entre varios modelos |
| Datos propios | Catálogo de entidades y servicios urbanos (`localData.js`) y casos en SQLite |
| Servicio externo de mapas | OpenStreetMap Nominatim y Overpass (geolocalización) y OSRM (rutas) |
| Persistencia | SQLite (`node:sqlite`): casos, trazabilidad, historial del chat y caché con expiración |

## Agentes y orquestación

Cada agente es un módulo independiente en `backend/agents/` con un contrato común: `name`, `responsibility`, `inputs`, `tools`, `outputs` y `run(entrada, traza)`. Los agentes no se llaman entre sí: solo el orquestador decide el orden y las condiciones.

| Agente | Responsabilidad | Recibe | Herramientas | Produce |
|---|---|---|---|---|
| **1. Analista Multimodal** (`analystAgent.js`) | Interpretar el caso y estructurarlo | Texto e imagen opcional | Gemini (multimodal), caché de análisis | Categoría, urgencia, resumen, `is_valid_case`, `affects_road` |
| **2. Especialista de Ubicación** (`locationAgent.js`) | Ubicar la novedad, asignar la entidad y registrar el caso | Análisis del Agente 1 y ubicación de la novedad | `buscar_servicios` (datos propios), geolocalización (OSM) | Coordenadas, entidad asignada, recomendaciones y acción de registro |
| **3. Planificador de Rutas** (`routeAgent.js`) | Calcular la mejor ruta y emitir alertas | Resultado del Agente 2, punto de partida, destino y novedades activas | Geolocalización (OSM), `calcular_ruta` (OSRM) | Mejor ruta, alternativas, alertas y recomendaciones |
| **4. Chat Contextual** (`chatAgent.js`) | Responder preguntas de seguimiento y ejecutar acciones | Caso guardado, pregunta y novedades activas | `buscar_servicios`, `consultar_novedades`, `calcular_ruta`, `actualizar_caso` (elegidas por Gemini) | Respuesta, herramientas usadas y cambios guardados en el caso |

### Mecanismo de orquestación
`agents/orchestrator.js` no contiene lógica de negocio. Ejecuta el flujo con estas condiciones:

```
Agente 1 ──► ¿información suficiente? ──no──► fin: caso rechazado (indica qué falta)
                     │ sí
                     ▼
              Agente 2 (siempre): ubica la novedad, asigna entidad, registra el caso
                     │
                     ▼
              Agente 3 (siempre participa):
                 · con destino                          → calcula la ruta
                 · sin destino y no es novedad vial     → usa la entidad asignada como destino
                 · sin destino y es novedad vial        → solicita el destino al usuario
```

Otras condiciones que modifican el flujo:
- Agente 1 reutiliza el análisis en caché si no hay imagen (no consume cuota de Gemini) y usa un análisis por defecto si Gemini falla.
- La ruta parte del **punto de partida**; si no se indica, parte de la ubicación de la novedad.
- Los agentes 1 a 3 los ejecuta el orquestador en orden fijo; el Agente 4 se activa en cada pregunta del chat y **Gemini decide qué herramientas invocar** (function calling, hasta 4 pasos por pregunta).

### Las tres ubicaciones del caso
| Campo | Obligatorio | Significado |
|---|---|---|
| `incident_location` | Sí | Dónde ocurre la novedad (por ejemplo, el hueco). Se marca en el mapa y cuenta como novedad vial para las rutas |
| `start_location` | No | Desde dónde inicia su recorrido el usuario |
| `destination_location` | No | A dónde va. Si se indica, se calcula la ruta |

## Herramientas y acciones

| Herramienta | Tipo | Quién la usa | Descripción |
|---|---|---|---|
| `buscar_servicios` | Datos propios | Agente 2, Agente 4 | Consulta el catálogo de entidades por categoría |
| `consultar_novedades` | Datos propios | Agente 4 | Lista las novedades viales de las últimas 24 h guardadas en SQLite |
| `geolocalizacion` | Servicio externo | Agentes 2 y 3 | Nominatim y Overpass; calcula cruces como "calle 77 con carrera 30" |
| `calcular_ruta` | Servicio externo | Agente 3, Agente 4 | OSRM: rutas alternativas penalizadas por novedades activas |
| `actualizar_caso` | **Acción** | Agente 4 | Cambia urgencia, agrega una nota o fija el destino del caso |

**Acciones que modifican el sistema** (no son solo texto del modelo; quedan guardadas y trazadas):
- **Registrar el caso** con prioridad y entidad asignada (Agente 2).
- **Actualizar el caso** desde el chat: urgencia, notas o destino (`actualizar_caso`).
- **Guardar la ruta calculada** en el caso desde el chat (`calcular_ruta`).

La interfaz marca cada respuesta del chat con las herramientas usadas (🔧) y las acciones ejecutadas (⚙).

## Persistencia y trazabilidad

Los casos se guardan en SQLite (`backend/data/urban.db`, configurable con `DB_PATH`) y sobreviven a reinicios. Cada caso conserva:

- **Caso:** texto, ubicaciones, análisis, recomendaciones, entidades, ruta y punto de partida.
- **Resultado y acción:** `recommendations` y `action_executed`.
- **Trazabilidad estructurada (`trace_events`):** un evento por cada participación de un agente o herramienta.
- **Trazabilidad legible (`trace_log`):** los mismos eventos como frases, que muestra la interfaz.
- **Historial del chat (`chat_history`):** cada pregunta, respuesta y herramientas usadas.

Formato de un evento de `trace_events`:
```json
{
  "at": "2026-10-17T17:29:58.874Z",
  "agent": "Agente 2 (Especialista de Ubicación)",
  "kind": "tool",
  "tool": "geolocalizacion",
  "input": "calle 77 con carrera 30",
  "output": "{\"lat\":4.67,\"lon\":-74.07,\"source\":\"OpenStreetMap Nominatim (intersección calculada)\"}",
  "message": "Agente 2 (Especialista de Ubicación): ubicación de la novedad geolocalizada..."
}
```
`kind` puede ser `agent` (decisión o resultado de un agente), `tool` (herramienta consultada) o `action` (cambio ejecutado en el sistema). Con esto se puede explicar cómo se obtuvo el resultado: qué agente actuó, qué herramienta usó, con qué entrada y qué devolvió. Las entradas y salidas se resumen a 400 caracteres.

**En la interfaz:** el panel "Trazabilidad de agentes y herramientas" muestra cada evento con etiquetas de agente, herramienta y tipo, la hora, y la entrada y salida desplegables. Los casos recientes se leen de `GET /api/cases` y al abrir uno se recupera de `GET /api/cases/:id` con su traza y su conversación del chat; nada de esto depende del navegador.

## Flujo de un caso
1. El usuario envía texto, ubicación de la novedad y, opcionalmente, imagen, punto de partida y destino.
2. El orquestador ejecuta al Agente 1. Si la información es insuficiente, rechaza el caso.
3. El Agente 2 busca la entidad responsable, geolocaliza la novedad y registra la acción.
4. El Agente 3 calcula la ruta y las alertas considerando las novedades activas.
5. Se guarda el caso con su trazabilidad y se responde a la interfaz, que dibuja la ruta en el mapa.
6. En el chat, el Agente 4 responde y puede consultar herramientas o actualizar el caso; cada uso queda en la traza.

## Tecnologías
| Capa | Tecnología |
|------|------------|
| Backend | Node.js 22.13 o superior, Express, cors, dotenv |
| Base de datos | SQLite integrada de Node (`node:sqlite`) |
| IA | `@google/genai` (Gemini) |
| Mapas | Nominatim, Overpass y OSRM (OpenStreetMap) |
| Frontend | React, Vite, TypeScript, Leaflet |

## Estructura del repositorio
```
urban-mobility/
├── backend/
│   ├── agents/
│   │   ├── orchestrator.js      # Orquestación: orden y condiciones
│   │   ├── analystAgent.js      # Agente 1
│   │   ├── locationAgent.js     # Agente 2
│   │   ├── routeAgent.js        # Agente 3
│   │   └── chatAgent.js         # Agente 4 (herramientas y acciones)
│   ├── services/
│   │   ├── gemini.js            # Cliente Gemini con respaldo entre modelos
│   │   ├── localData.js         # Datos propios de servicios urbanos
│   │   ├── geolocation.js       # Nominatim y Overpass
│   │   ├── routing.js           # OSRM y evaluación de novedades
│   │   ├── trace.js             # Trazabilidad estructurada
│   │   └── db.js                # SQLite: casos y caché
│   ├── index.js                 # API REST
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Interfaz principal
│   │   ├── api.ts               # Cliente HTTP
│   │   ├── types.ts             # Tipos de la API
│   │   └── components/          # Chat, mapa y panel de trazabilidad
│   └── .env.example
└── README.md
```

## Instalación y ejecución

**Requisitos:** Node.js 22.13 o superior y una clave de API de Google Gemini.

### Backend
```bash
cd backend
pnpm install            # o npm install
cp .env.example .env    # y completa GEMINI_API_KEY
pnpm start              # http://localhost:3000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env    # ajusta VITE_API_URL si el backend usa otro puerto
npm run dev             # http://localhost:5173
```

Para generar la versión de producción del frontend: `npm run build`.

## Variables de entorno
Nunca subas claves reales al repositorio: `.env` está en `.gitignore` y solo se versionan los `.env.example`.

### `backend/.env`
| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `PORT` | No (3000) | Puerto del servidor |
| `GEMINI_API_KEY` | Sí | Clave de Google Gemini. Sin ella el análisis usa un valor por defecto y el chat responde con un mensaje de respaldo |
| `GEMINI_MODELS` | No | Modelos separados por coma, usados en orden si uno agota su cuota |
| `GEMINI_USE_SEARCH` | No | `true` activa la búsqueda de Google en las respuestas (requiere facturación) |
| `DB_PATH` | No | Ruta del archivo SQLite (por defecto `backend/data/urban.db`) |

### `frontend/.env`
| Variable | Descripción |
|----------|-------------|
| `VITE_API_URL` | URL base del backend, por ejemplo `http://localhost:3000` |

## API

### `POST /api/process-case`
Procesa un caso con el flujo de agentes.

```json
{
  "user_text": "Hay un hueco enorme en la vía",
  "incident_location": "Calle 77 con carrera 30, Bogotá",
  "start_location": "Portal de las Américas",
  "destination_location": "Calle 100 con NQS",
  "image_base64": "<opcional, base64 sin prefijo data:>"
}
```
`start_location`, `destination_location` e `image_base64` son opcionales. `origin_location` se acepta como alias de `incident_location`.

Respuesta `201`: `case_id`, `analysis`, `recommendations`, `action_result`, `location`, `services`, `route` (con geometría para dibujarla), `start_point`, `trace` y `trace_events`.
Errores: `400` si faltan `user_text` o `incident_location`; `500` ante un fallo interno.

### `POST /api/chat-contextual`
`{ "case_id": 1, "question": "..." }`. Responde con `response` y `tools_used` (herramientas y acciones ejecutadas). `404` si el caso no existe.

### `GET /api/cases`
Lista los casos persistidos, del más reciente al más antiguo (`?limit=50`, máximo 200): id, fecha, texto, ubicación, categoría, urgencia y acción.

### `GET /api/cases/:id`
Recupera el caso completo: resultado, acción, `trace_log`, `trace_events` y `chat_history`.

### `GET /api/agents`
Describe cada agente: responsabilidad, entradas, herramientas y salidas.

## Limitaciones conocidas
- Los tiempos de ruta no incluyen tráfico en vivo; los retrasos se estiman con las novedades reportadas en el sistema.
- "Notificar" a la entidad es un registro en el sistema; no se envía un correo ni una llamada real.
- El catálogo de servicios es estático y de demostración.
- Los servidores públicos de Overpass son inestables: si fallan, el cruce se calcula con Nominatim (menos exacto) y, como último recurso, se usa una ubicación simulada marcada en `source`.
- Nominatim y OSRM públicos tienen límites de uso.
- Los casos creados antes de separar las ubicaciones no tienen `start_point` ni `trace_events`.
