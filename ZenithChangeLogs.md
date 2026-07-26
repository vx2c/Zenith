# Registro de Cambios de IA

Cada vez que una IA realice cambios en el proyecto, deberá agregar un nuevo registro en el archivo `ZenithChangeLogs.md`.

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

> Si una IA modifica el proyecto y no actualiza `ZenithChangeLogs.md`, la tarea se considera incompleta.



- Motivo:
  - Vercel Hobby tiene un límite de 12 Serverless Functions. El proyecto superó ese límite. Esta refactorización reduce el conteo a exactamente 3 funciones y restaura el despliegue exitoso.

## [2026-07-26 10:03 UTC]

- Archivos modificados:
  - api/chat.js
  - api/session-store.js
  - artifacts/zenith/src/components/dashboard.tsx
  - script.js
  - style.css
  - ZenithChangeLogs.md

- Archivos creados:
  - ZENITH_WORKSPACE_AGENT_UPGRADE.md

- Cambios realizados:
  - Se agregó una capa persistente de estado de tareas del Workspace Agent con objetivo, plan, pasos completados, pasos pendientes, herramienta actual, último resultado y siguiente acción.
  - Cada ejecución de herramienta genera automáticamente eventos de Workspace con estados de planificación, ejecución, finalización o error.
  - El agente continúa su ciclo multi-herramienta hasta completar, bloquear o alcanzar el límite de seguridad, conservando la comunicación existente con el plugin.
  - La interfaz raíz y el artefacto Zenith muestran tarjetas visuales de actividad en lugar de exponer la complejidad interna de las herramientas.
  - Las tarjetas de Workspace solo se muestran cuando existe una sesión activa de Roblox Studio.

- Motivo:
  - Transformar Zenith de un chat con herramientas en un agente de Workspace que gestiona objetivos completos, mantiene progreso persistente y comunica visualmente sus operaciones sin reemplazar el sistema de sesiones, heartbeat, cola de comandos ni plugin.

## [2026-07-26 07:10 UTC]

- Archivos modificados:
  - api/chat.js

- Cambios realizados:
  - `extractToolCall` ahora valida que el JSON parseado tenga una clave `name` (string, presente en `SUPPORTED_STUDIO_TOOLS`) y `args` (objeto) antes de devolverlo. Si el modelo genera un JSON con una clave incorrecta (ej. `"tool"` en vez de `"name"`), la función devuelve `null` en vez del objeto roto, permitiendo que el enforcement/retry existente se active en vez de ejecutar `undefined` contra el plugin.
  - `buildCallMessages` pasó de 2 fases a 3: `TOOL_CALL_DIRECTIVE` (sin tools ejecutadas) → nueva `CONTINUE_DIRECTIVE` (tools ejecutadas pero quedan pasos del plan `pendingSteps` pendientes) → `EXPLANATION_DIRECTIVE` (tools ejecutadas y nada pendiente). Antes, cualquier ronda después de la primera tool saltaba directo a modo explicación, cortando planes multi-paso apenas se ejecutaba el primer tool result.

- Motivo:
  - El agente perdía el control del flujo tras el primer comando: ejecutaba una tool con nombre `undefined` (error "Unsupported Studio tool undefined") y, en los casos donde sí ejecutaba una tool real (ej. `find_instances`), se detenía sin continuar con los pasos restantes del plan (crear GUI, botón, script). Ambas causas estaban en `chat.js`, no en el plugin ni en `session-store.js`.

## [2026-07-26 07:45 UTC]

- Archivos modificados:
  - api/chat.js
  - plugin/AIConnector.plugin.lua

- Cambios realizados:
  - Nueva función `describeToolCallFailure(text)` en `chat.js`: diagnostica si el modelo no intentó ningún `TOOL:` o si lo intentó y el JSON quedó mal formado/con shape inválida, devolviendo el motivo específico.
  - `buildToolEnforcementMessage` ahora recibe ese diagnóstico y le da al modelo feedback específico sobre qué falló, en vez de un genérico "debes usar una tool". Además instruye explícitamente no meter código Lua (`source`) dentro de `children` anidados de `create_instance`/`create_gui`.
  - Si se agotan los reintentos de enforcement y nunca se ejecutó ninguna tool real, la tarea del Workspace ya no se marca como `completed` — se marca `failed`, y se le informa al usuario con un error honesto en vez de mostrarle el JSON roto como si fuera la respuesta final.
  - `MAX_TOOL_ENFORCEMENT_RETRIES` subió de 1 a 2.
  - Nueva regla T14 en el system prompt: prohíbe explícitamente incluir `source` dentro de `children` anidados; scripts deben crearse con un `create_script` separado.
  - En `plugin/AIConnector.plugin.lua`, `createChildTree` ahora escribe `spec.source` en instancias hijas que sean `LuaSourceContainer` (Script/LocalScript/ModuleScript), usando la misma función `writeSource` que ya usaba `create_script`. Antes, un `source` anidado se ignoraba en silencio y el script quedaba creado pero vacío, sin ningún error visible en ningún lado de la cadena.

- Motivo:
  - El agente generaba un `TOOL:` de `create_instance` con GUI + botón + script anidado en un solo payload JSON muy complejo, que se rompía al parsear (JSON inválido). Al agotar el único reintento existente, el sistema mostraba el JSON crudo roto como si fuera la respuesta final y marcaba la tarea como "completada" sin haber ejecutado nada — confirmado con logs del plugin que solo mostraban `ping -> pong`, ninguna ejecución real. Adicionalmente, incluso si el JSON hubiera parseado bien, el LocalScript anidado se habría creado sin código porque `createChildTree` nunca escribía `source`.

## [2026-07-26 09:30 UTC]

- Archivos modificados:
  - index.html
  - script.js
  - style.css
  - api/system.js

- Cambios realizados:
  - Rediseño completo de la pantalla de login (landing): fondo full-bleed con canvas de olas monocromáticas animadas (`initWaveCanvas`, varias capas de senoides), reemplazando el card blanco estático anterior.
  - Nuevo widget tipo chat con typewriter cíclico (`startTypewriter`, `LANDING_PHRASES`) que tipea, borra y retipea distintas frases en la voz del asistente.
  - Botón de login renombrado a "Start Build" (mismo `id="btn-login"` y mismo handler `openLogin()`, sin cambios en la lógica de OAuth).
  - Main Menu: se agregó el mismo canvas de olas de fondo (capa adicional detrás de los orbs existentes) para reforzar la animación de fondo.
  - `api/system.js` → `handleRobloxCallback` ahora obtiene la foto de perfil desde `thumbnails.roblox.com` usando `claims.sub` e incluye el campo `picture` en la respuesta.
  - `script.js` → `initMainMenu()` agrega un fallback: si no hay `avatarUrl` en localStorage, pide el avatar directo a `/api/avatar` usando el `userId` guardado.

- Motivo:
  - El usuario pidió un rediseño visual del login (fondo animado, chat con typewriter, botón renombrado) y reportó que en el Main Menu el fondo no tenía animación visible y el avatar no aparecía justo después de loguearse. La causa del avatar: `handleRobloxCallback` nunca solicitaba la foto de perfil a Roblox, por lo que `data.picture` era siempre `undefined` y el `localStorage.setItem('roblox_avatar', ...)` en `roblox-callback.html` nunca se ejecutaba.

## [2026-07-26 10:15 UTC]

- Archivos modificados:
  - index.html

- Cambios realizados:
  - Se instaló la etiqueta de Google Analytics (gtag.js, ID `G-BXMLJ8B7F6`) justo después del elemento `<head>`, como indica la documentación de Google.

- Motivo:
  - Habilitar medición de tráfico del sitio vía Google Analytics.

## [2026-07-26 11:00 UTC]

- Archivos creados:
  - robots.txt
  - sitemap.xml

- Archivos modificados:
  - index.html

- Cambios realizados:
  - `robots.txt` nuevo en la raíz: permite indexar todo el sitio salvo `/roblox-callback`, apunta a `sitemap.xml`.
  - `sitemap.xml` nuevo en la raíz: incluye la home (el sitio es una SPA de una sola página real).
  - `index.html`: título y meta description más específicos, `meta robots`, `link canonical`, Open Graph, Twitter Card y JSON-LD (`SoftwareApplication`) para mejorar cómo Google y las redes interpretan el sitio.

- Motivo:
  - Preparar el sitio para indexación en Google Search Console y mejorar la relevancia de búsqueda más allá del nombre genérico "Zenith".

## [2026-07-26 12:30 UTC]

- Archivos modificados:
  - index.html
  - script.js
  - style.css
  - roblox-callback.html

- Cambios realizados:
  - Rebrand de "Zenith" a "xZenith Roblox" en todo el frontend: `<title>`, meta description, Open Graph, Twitter Card, JSON-LD, wordmark del login (ahora "XZENITH" con "ROBLOX" como sub-tag), copy del Main Menu, sidebar, mensajes del chat, nota de input, texto de settings, botón de Discord, y título de la pestaña de `roblox-callback.html`.
  - Nuevo estilo `.z-label-sub` en `style.css` para el sub-tag "ROBLOX" junto al wordmark.
  - Se mantuvo el ícono/favicon "Z" existente sin cambios (decisión del usuario de no rehacer el sistema visual, solo el nombre).

- Motivo:
  - "Zenith" es un nombre muy genérico con múltiples proyectos no relacionados usando variantes similares en el mismo espacio (Roblox + IA), incluyendo un "ZenIth" asociado a herramientas de exploit/cheat — mala compañía de marca. El dominio `xzenith.net` se mantiene sin cambios.
