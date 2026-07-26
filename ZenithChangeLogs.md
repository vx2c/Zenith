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
