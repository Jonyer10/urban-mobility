# Solución Inteligente Multimodal de Movilidad y Localización de Servicios Urbanos

Aplicación web que recibe una necesidad urbana (texto, ubicación y opcionalmente una imagen), la analiza con IA, la deriva a la entidad responsable usando datos propios y geolocalización externa, y deja trazabilidad completa del proceso.

## Tabla de contenido
1. [Descripción de la solución](#descripción-de-la-solución)
2. [Arquitectura](#arquitectura)
3. [Flujo de un caso](#flujo-de-un-caso)
4. [Tecnologías](#tecnologías)
5. [Estructura del repositorio](#estructura-del-repositorio)
6. [Instalación y ejecución](#instalación-y-ejecución)
7. [Variables de entorno](#variables-de-entorno)
8. [API](#api)
9. [Frontend](#frontend)
10. [Limitaciones conocidas](#limitaciones-conocidas)
11. [Solución de problemas](#solución-de-problemas)

## Descripción de la solución
El ciudadano describe un problema de movilidad o infraestructura (por ejemplo, un hueco en la vía o un semáforo dañado), indica dónde ocurre y puede adjuntar una foto. El sistema:

- Interpreta el caso de forma multimodal (texto + imagen) con Google Gemini.
- Consulta un repositorio propio de entidades y servicios urbanos.
- Geolocaliza la dirección con OpenStreetMap Nominatim.
- Genera recomendaciones y registra una acción formal con prioridad y entidad asignada.
- Permite consultar el caso y conversar sobre él.

## Arquitectura

```
┌────────────────────┐   fetch (JSON)   ┌──────────────────────────────┐
│ Frontend           │ ───────────────► │ Backend Express              │
│ React + Vite + TS  │ ◄─────────────── │  index.js (API REST)         │
└────────────────────┘                  │   └─ agents/orchestrator.js  │
                                        │       ├─ Agente 1 (Gemini)   │
                                        │       └─ Agente 2            │
                                        │           ├─ localData.js    │
                                        │           └─ geolocation.js ─┼─► OpenStreetMap
                                        └──────────────────────────────┘
```

- **Agente 1, Analista Multimodal:** evalúa si la información es suficiente y estructura categoría, urgencia y resumen.
- **Agente 2, Especialista de Ubicación y Solución:** ejecuta las herramientas (datos propios y geolocalización) y arma recomendaciones y acción formal.
- **Persistencia y trazabilidad:** cada caso se guarda con su `trace_log`, que registra cada paso de los agentes.

## Flujo de un caso
1. El usuario envía texto, ubicación e imagen opcional.
2. El Agente 1 analiza y devuelve categoría, urgencia y resumen. Si el texto es insuficiente, rechaza el caso indicando qué falta.
3. El Agente 2 busca la entidad en los datos propios según la categoría.
4. Se geolocaliza la ubicación (con respaldo simulado si el servicio externo falla).
5. Se registra la acción, se guarda el caso y se responde al frontend.

## Tecnologías
| Capa | Tecnología |
|------|------------|
| Backend | Node.js, Express, cors, dotenv |
| IA | `@google/genai` (Gemini 2.5 Flash) |
| Geolocalización | OpenStreetMap Nominatim (Fetch API) |
| Frontend | React, Vite, TypeScript |
| Mapa | Embed de OpenStreetMap |

## Estructura del repositorio
```
urban-mobility/
├── backend/
│   ├── agents/orchestrator.js   # Orquestación de agentes
│   ├── services/
│   │   ├── localData.js         # Datos propios de servicios urbanos
│   │   └── geolocation.js       # Integración con Nominatim
│   ├── index.js                 # API REST
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Interfaz principal
│   │   ├── api.ts               # Cliente HTTP hacia el backend
│   │   ├── types.ts             # Tipos de la API
│   │   └── components/          # Chat y mapa
│   └── .env.example
└── README.md
```

## Instalación y ejecución

**Requisitos:** Node.js 18 o superior y una clave de API de Google Gemini.

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
| `GEMINI_API_KEY` | Sí | Clave de Google Gemini. Sin ella el análisis usa un valor por defecto |
| `DATABASE_URL`, `DB_*` | No | Reservadas para una futura base de datos PostgreSQL; hoy no se usan |

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
  "origin_location": "Carrera 7 con calle 72, Bogotá",
  "image_base64": "<opcional, base64 sin prefijo data:>"
}
```

Respuesta `201`:
```json
{
  "case_id": 1,
  "analysis": { "category": "Movilidad", "urgency_level": "Medio", "summary": "...", "is_valid_case": true, "missing_info_reason": null },
  "recommendations": ["..."],
  "action_result": "Caso registrado formalmente...",
  "location": { "lat": 4.65, "lon": -74.08, "display_name": "...", "source": "OpenStreetMap Nominatim" },
  "services": [{ "name": "...", "status": "...", "contact": "..." }],
  "trace": ["Agente 1: ...", "Agente 2: ..."]
}
```
Errores: `400` si faltan `user_text` u `origin_location`; `500` ante un fallo interno.

### `POST /api/chat-contextual`
Responde sobre un caso ya procesado: `{ "case_id": 1, "question": "..." }`. Devuelve `404` si el caso no existe.

### `GET /api/cases/:id`
Recupera el caso completo con su trazabilidad.

## Frontend
- Formulario con texto, ubicación e imagen (con vista previa) y ejemplos rápidos.
- Indicador de progreso de los agentes mientras se procesa.
- Resultados: análisis con urgencia, recomendaciones, entidades, mapa, chat contextual y trazabilidad.
- Historial de casos recientes, botón para copiar el resumen y modo claro/oscuro.

## Limitaciones conocidas
- La persistencia es en memoria: los casos se pierden al reiniciar el backend.
- El chat contextual responde con una plantilla basada en los datos del caso; no consulta al modelo.
- El catálogo de servicios es estático y de demostración.
- El servicio Nominatim tiene límites de uso; si falla, se devuelve una ubicación simulada de respaldo.

## Solución de problemas
- **El puerto 3000 está ocupado:** inicia el backend con otro puerto (`PORT=3001`) y ajusta `VITE_API_URL` en `frontend/.env`.
- **El análisis siempre dice "Movilidad":** falta `GEMINI_API_KEY` en `backend/.env`.
- **El chat dice "Caso no encontrado":** el backend se reinició y el caso ya no está en memoria; envía el caso de nuevo.
- **Error de CORS o red en el navegador:** verifica que el backend esté activo y que `VITE_API_URL` sea correcta; reinicia Vite tras cambiar `.env`.
