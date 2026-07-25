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

## 2026-07-25 — Refactor Vercel Serverless Functions (≤3)

- Archivos creados:
  - `api/studio.js`
  - `api/system.js`

- Archivos eliminados:
  - `api/connect.js`
  - `api/heartbeat.js`
  - `api/command_result.js`
  - `api/plugin-status.js`
  - `api/queue-command.js`
  - `api/avatar.js`
  - `api/config.js`
  - `api/debug-models.js`
  - `api/status.js`
  - `api/roblox-callback.js`

- Archivos modificados:
  - `vercel.json`
  - `reedme.md`

- Cambios realizados:
  - Consolidados 10 endpoints en 2 nuevas funciones serverless usando enrutamiento interno por `req.url` (`?_r=<ruta>`).
  - `api/studio.js`: connect, heartbeat, command_result, plugin-status, queue-command, avatar.
  - `api/system.js`: config, status, debug-models, roblox-callback.
  - `api/chat.js` permanece sin cambios.
  - `vercel.json` actualizado: `functions` lista solo 3 archivos; `rewrites` reescritos para apuntar a las nuevas funciones con el parámetro `_r`.
  - Todas las URLs existentes del frontend y del plugin permanecen iguales.

- Motivo:
  - Vercel Hobby tiene un límite de 12 Serverless Functions. El proyecto superó ese límite. Esta refactorización reduce el conteo a exactamente 3 funciones y restaura el despliegue exitoso.
