# Registro de Cambios de IA

Cada vez que una IA realice cambios en el proyecto, deberá agregar un nuevo registro en el archivo `AI_CHANGELOG.md`.

Se deben registrar:

* Archivos creados.
* Archivos modificados.
* Archivos eliminados.
* Cambios importantes en la lógica o estructura del proyecto.

Formato obligatorio:

```md
## [FECHA Y HORA]

- Archivos modificados:
  - archivo1
  - archivo2

- Cambios realizados:
  - Descripción breve de los cambios.

- Motivo:
  - Explicación breve.
```

Nunca sobrescribir registros anteriores. Siempre agregar la nueva entrada al final del archivo.

> Si una IA modifica el proyecto y no actualiza `AI_CHANGELOG.md`, la tarea se considera incompleta.

## 2026-07-25

- Archivos modificados:
  - `api/aiService.js`
  - `api/chat.js`
  - `artifacts/api-server/src/routes/aiService.ts`
  - `IA_CHANGELOG.md`

- Cambios realizados:
  - Se priorizaron los modelos `gemma-4-26b-a4b-it`, `nemotron-nano-9b-v2` y `gpt-oss-20b`.
  - Se agregó `openrouter/free` como fallback dinámico para la disponibilidad cambiante del pool gratuito.
  - Se conservaron y mostraron diagnósticos de red, HTTP, streaming y respuestas vacías cuando todos los modelos fallan.

- Motivo:
  - Zenith mostraba un error genérico aunque OpenRouter estuviera devolviendo una causa específica, y la cadena fija no tenía un fallback dinámico para los cambios del proveedor.
