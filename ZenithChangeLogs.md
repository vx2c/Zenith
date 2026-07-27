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

## [2026-07-26 13:00 UTC]

- Archivos modificados:
  - api/chat.js

- Cambios realizados:
  - Nueva función `isAskingClarification(text)`: detecta cuando el agente responde con una pregunta de aclaración legítima (respuesta corta < 500 chars, sin código, sin TOOL:, termina en `?`). Esto distingue "el agente olvidó la herramienta" de "el agente inteligentemente pidió contexto".
  - El enforcement de herramientas ahora tiene una salida explícita: si `isAskingClarification(text)` es `true`, la respuesta se transmite al usuario en lugar de inyectar el mensaje de reintento. El agente puede preguntar sin ser silenciado.
  - `intentNote` en el system prompt reemplazado: ya no dice "Execute immediately" sin condiciones. Ahora incluye la regla "SMART AGENT RULE: si el objetivo es ambiguo, pregunta UNA vez antes de adivinar".
  - Nueva regla `T15` en el system prompt: "CLARIFICATION OVER GUESSING — antes de ejecutar una herramienta sobre un objetivo ambiguo, pregunta UNA pregunta concisa. Después de que responda, procede con la herramienta inmediatamente."
  - `TOOL_CALL_DIRECTIVE` actualizado: agrega una excepción explícita ("EXCEPTION — CLARIFY FIRST") que le indica al modelo que una pregunta de aclaración de una línea es válida cuando el objetivo es genuinamente ambiguo.

- Motivo:
  - El sistema de enforcement anterior era binario: o ejecuta una herramienta o falla. Esto impedía al agente hacer preguntas inteligentes como "veo varios scripts — ¿cuál tiene el error?". La consecuencia era que ejecutaba get_tree sobre toda la jerarquía o inventaba un objetivo, en lugar de pedir clarificación como haría un agente profesional (similar a usedrebirth.com). Los cambios agregan un tercer estado: CLARIFY, que es un comportamiento agente válido.

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

## [2026-07-27]

- Archivos modificados:
  - `api/chat.js`
  - `artifacts/zenith/src/components/dashboard.tsx`
  - `script.js`
  - `style.css`

- Cambios realizados:

  ### api/chat.js
  - Agregado `hasEnoughContext(text)`: detecta si el mensaje del usuario ya contiene un dot-path (e.g. `ServerScriptService.X`), nombre entre comillas, o nombre de servicio Roblox — en cuyo caso la clarificación es innecesaria.
  - La comprobación de clarificación en `agentLoop` ahora requiere AMBAS condiciones: `isAskingClarification(text)` AND `!hasEnoughContext(lastUserMsg)`. Si el usuario ya dio un nombre/ruta, el agente ya no puede preguntar — debe ejecutar la herramienta de inmediato.
  - Regla T15 en el system prompt actualizada: especifica que NUNCA se debe pedir información que el usuario ya proporcionó (si hay dot-path, nombre o servicio, ir directo a `find_instances`/`search_scripts`).
  - `TOOL_CALL_DIRECTIVE` actualizado: la excepción CLARIFY FIRST ahora aclara explícitamente que no aplica cuando el usuario ya dio ruta, nombre entre comillas, o servicio Roblox.

  ### artifacts/zenith/src/components/dashboard.tsx
  - Eliminado el bloque `if (parsed.workspace_event)` del bucle SSE de `useChat`. Este bloque creaba entradas duplicadas en la timeline junto con los eventos `timeline` correctos. Ahora solo se procesan eventos `timeline`.

  ### script.js
  - Agregado `TOOL_EMOJI_MAP`: mapeo de nombre de herramienta a emoji (🔍, 📄, ✏️, 🧱, etc.).
  - Agregado `cardsContainer: null` al objeto `state`.
  - `aiMsgEl()` ahora crea un div `.z-cards-container.hidden` entre el nombre y el texto, y lo retorna como `cardsEl`.
  - `sendMsg()`: captura `cardsEl` de `aiMsgEl`, lo guarda en `state.cardsContainer`, y siempre oculta el panel de actividad (activity-panel).
  - Bloque SSE: eliminado procesamiento de `workspace_event` (duplicado legacy). Solo se procesan eventos `timeline`, que llaman a `renderInlineCards(state.cardsContainer, ...)` para actualizar las tarjetas en la burbuja activa.
  - Agregada función `renderInlineCards(container, events)`: renderiza tarjetas inline en el bubble del mensaje usando el emoji, label, badge de estado y barra de progreso animada. Actualiza en-place los elementos existentes por `data-zid`.
  - `renderWorkspaceEvents()` ahora siempre oculta el panel (el panel accordion ya no se usa para mostrar datos).

  ### style.css
  - Agregadas clases `.z-cards-container`, `.z-card`, `.z-card-emoji`, `.z-card-body`, `.z-card-label`, `.z-card-detail`, `.z-card-badge` (y variantes `--running/--completed/--error/--plan`), `.z-card-bar-wrap`, `.z-card-bar`.
  - Animación `@keyframes z-bar-pulse` para barra de progreso en estado running.
  - Estilos dark mode para todas las variantes de z-card.

- Motivo:
  - Fix del agente: ya no pregunta clarificación cuando el usuario ya dio suficiente contexto (nombre, ruta, servicio). Evita el comportamiento frustrante de pedir "¿cuál script?" cuando el usuario escribió "ServerScriptService.LeaderstatsSystem".
  - Fix de duplicados: los eventos `workspace_event` y `timeline` eran procesados ambos, creando dos tarjetas por cada acción de herramienta. Ahora solo se usa `timeline`.
  - Inline activity cards: las acciones del agente aparecen como tarjetas compactas dentro de la burbuja del mensaje (no en el panel accordion colapsado), con emoji, badge de estado y barra animada — visible sin ningún clic adicional.

## [2026-07-27 — Agent Loop Critical Fix]

- Archivos modificados:
  - `api/chat.js`

- Cambios realizados:

  ### api/chat.js — Fix del loop del agente (bugs críticos)

  **Bug 1 — AI usa nombre de herramienta inválido después de ejecutar tools:**
  - El modelo a veces escribe `TOOL:{"name":"get_script",...}` (nombre no soportado) en vez de `read_script`. `extractToolCall` retornaba null, el loop terminaba, y el JSON crudo aparecía en el bubble del chat.
  - Fix: Nuevo guard en rama `!toolCall` — si `toolsExecuted > 0` y el texto contiene `TOOL:` (intento de tool call que falló parsing), se hace un retry con lista de herramientas válidas.
  - Fix adicional: `sanitizeForDisplay(text)` filtra líneas `TOOL:` del texto antes de streamarlo al usuario, evitando JSON crudo en el chat.

  **Bug 2 — AI escribe PLAN sin ejecutar herramientas y el loop termina:**
  - Causa raíz: `buildCallMessages` usaba `EXPLANATION_DIRECTIVE` cuando `toolsExecuted > 0 && !hasPendingWork`. Después de herramientas de lectura (find_instances + read_script), `hasPendingWork` siempre era false (pendingSteps viene vacío), forzando `EXPLANATION_DIRECTIVE` que le decía al AI "el objetivo está satisfecho, responde ahora". El AI obedecía y paraba, mostrando "Workspace task complete" sin haber creado nada.
  - Fix principal: `buildCallMessages` ahora usa solo dos fases — `TOOL_CALL_DIRECTIVE` (round 0) y `CONTINUE_DIRECTIVE` (cualquier round donde toolsExecuted > 0). `EXPLANATION_DIRECTIVE` eliminado. `CONTINUE_DIRECTIVE` ya tiene escape hatch integrado: el AI puede terminar si detecta que el objetivo está completo.
  - Fix secundario: nuevo guard en rama `!toolCall` — si `toolsExecuted > 0` y la respuesta contiene texto PLAN (PLAN: seguido de pasos numerados) sin TOOL call, se inyecta mensaje de sistema forzando al AI a emitir el primer `TOOL:{...}` del plan.

  **Funciones nuevas:**
  - `hasPlanText(text)`: detecta "PLAN:" seguido de pasos numerados en la respuesta del AI
  - `sanitizeForDisplay(text)`: elimina líneas que empiezan con `TOOL:` del texto visible al usuario

- Motivo:
  - El agente creaba planes detallados y luego paraba sin ejecutarlos, requiriendo que el usuario repitiera el mensaje para que funcionara (comportamiento observado en screenshot del usuario). La causa era `EXPLANATION_DIRECTIVE` que se activaba prematuramente. Ahora el agente continúa hasta completar todos los pasos del plan.
