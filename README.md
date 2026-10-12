# Solución Inteligente Multimodal de Movilidad y Localización de Servicios Urbanos

## Descripción de la Solución
Aplicación web inteligente diseñada para procesar necesidades urbanas mediante entradas multimodales (texto e imágenes), integrando datos propios, geolocalización en tiempo real, orquestación de agentes especializados y persistencia con trazabilidad completa.

## Arquitectura Implementada
- **Backend:** Node.js con Express (API RESTful asíncrona).
- **Modelo de IA:** Google Gemini (Gemini Flash) para el análisis multimodal de texto e imágenes.
- **Datos Propios:** Repositorio interno de entidades y servicios urbanos.
- **Geolocalización Externa:** API de OpenStreetMap Nominatim para coordenadas y puntos geográficos.
- **Agentes Especializados:**
  - *Agente 1 (Analista Multimodal):* Evalúa la suficiencia de la información y estructura los datos del usuario.
  - *Agente 2 (Especialista de Ubicación y Solución):* Coordina herramientas de mapas y datos propios para generar recomendaciones y acciones formales.
- **Persistencia y Trazabilidad:** Almacenamiento local con registro detallado de traza por cada caso procesado.

## Tecnologías Utilizadas
- JavaScript (Node.js)
- Express.js
- @google/genai (SDK oficial de Gemini)
- Fetch API (Integración con servicios de mapas)

## Instrucciones de Instalación y Ejecución

1. Clona el repositorio e ingresa a la carpeta del backend:
   ```bash
   cd backend