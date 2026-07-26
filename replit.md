# Zenith

## About

Zenith es un asistente de IA diseñado para integrarse con proyectos de Roblox Studio mediante un conector. Este conector funciona a través de un plugin de Roblox Studio, el cual permite establecer una conexión entre Zenith y el proyecto.

Una vez conectado, el plugin envía solicitudes (heartbeat) a la aplicación web para mantener la comunicación activa y permitir que Zenith interactúe con el proyecto en tiempo real.

El objetivo principal del proyecto no es únicamente generar código Lua. Zenith debe comportarse como un agente de IA capaz de inspeccionar, leer, crear, modificar y organizar proyectos completos de Roblox Studio utilizando herramientas reales ejecutadas desde el plugin.

---

# Current Project Status

Actualmente el sistema base de comunicación ya funciona correctamente.

Estado actual:

- ✅ Plugin publicado y funcional.
- ✅ Conexión entre la web y Roblox Studio.
- ✅ Sistema de sesiones.
- ✅ Heartbeat.
- ✅ Cola de comandos.
- ✅ Recepción de resultados desde Roblox Studio.
- ✅ HTTP Requests.
- ✅ Script Injection.

El problema actual NO es el plugin.

El cuello de botella del proyecto es el comportamiento de la IA. Algunas veces utiliza correctamente las herramientas disponibles y otras veces responde utilizando información imaginaria en lugar de ejecutar comandos reales.

Todo el desarrollo futuro debe enfocarse principalmente en mejorar el comportamiento del agente y no en reconstruir el sistema de comunicación existente.

---

# Project Architecture

Flujo actual del sistema:

```
Developer
      │
      ▼
Zenith Website
      │
      ▼
chat.js
      │
      ▼
Agent Loop
      │
      ▼
enqueueCommand()
      │
      ▼
session-store.js
      │
      ▼
Heartbeat Queue
      │
      ▼
Roblox Plugin
      │
      ▼
Roblox Studio
      │
      ▼
command_result.js
      │
      ▼
Agent Loop
      │
      ▼
Final AI Response
```

Este flujo ya funciona correctamente y no debe ser reemplazado sin autorización.

---

# Plugin Code

El código principal del plugin se encuentra en:

`plugin/IAConector.plugin.lua`

El plugin ya implementa correctamente:

- HTTP Requests
- Heartbeat
- Session Connection
- Script Injection
- Command Queue
- Command Result
- Comunicación con la aplicación web

No modificar el plugin a menos que sea absolutamente necesario o el usuario lo solicite explícitamente.

Antes de cambiar cualquier comportamiento del plugin, revisar primero si el problema realmente pertenece al backend.

---

# Important Folders

## Folder 1 - `api`

Este directorio contiene la lógica principal del backend.

Archivos importantes:

* `aiService.js`
* `avatar.js`
* `chat.js`
* `command_result.js`
* `config.js`
* `connect.js`
* `debug-models.js`
* `heartbeat.js`
* `plugin-status.js`
* `queue-command.js`
* `roblox-callback.js`
* `session-store.js`
* `status.js`

### Responsabilidades

**chat.js**

Contiene el flujo principal del agente.

Aquí se manejan:

- System Prompt
- Agent Loop
- Tool Calls
- Tool Results
- Comunicación con el plugin

La mayor parte del comportamiento inteligente de Zenith pertenece aquí.

---

**aiService.js**

Únicamente administra la comunicación con OpenRouter.

Responsabilidades:

- Streaming
- Modelos
- Fallback
- Provider

No debe contener lógica relacionada con Roblox Studio.

---

**session-store.js**

Administra:

- sesiones
- cola de comandos
- resultados
- conexión entre web y plugin

---

**heartbeat.js**

Mantiene viva la comunicación entre la web y Roblox Studio.

---

## Folder 2

* `artifacts`
* `api-server`
* `mockup-sandbox`
* `zenith`

---

## Folder 3

* `lib`
* `api-client-react`
* `api-spec`
* `api-zod`
* `db`

---

## Folder 4

* `scripts`
* `src`

Archivos principales:

* `package.json`
* `post-merge.sh`
* `tsconfig.json`

---

## Folder 5 - `.migration-backup`

Contiene una copia de seguridad de archivos importantes:

* `api`
* `docs`
* `.gitignore`
* `.replit`
* `.scaffold-applied`
* `README.md`
* `index.html`
* `package.json`
* `roblox-callback.html`
* `script.js`
* `style.css`
* `vercel.json`

No eliminar esta carpeta.

---

# Agent Behavior

Zenith NO es un chatbot tradicional.

Zenith es un agente para Roblox Studio.

Cuando exista una conexión activa con Roblox Studio, Zenith debe trabajar utilizando herramientas reales.

Nunca debe inventar información del proyecto.

Nunca debe asumir el contenido del Explorer.

Nunca debe afirmar que modificó un proyecto sin haber ejecutado una herramienta primero.

El plugin siempre representa la fuente de verdad.

---

# Tool System

Cuando el usuario solicita acciones dentro de Roblox Studio, Zenith debe utilizar herramientas reales.

Ejemplos:

- crear scripts
- editar scripts
- leer scripts
- crear interfaces
- crear objetos
- buscar objetos
- modificar propiedades
- mover objetos
- clonar objetos
- eliminar objetos
- obtener selección
- inspeccionar Explorer

El agente nunca debe responder únicamente con texto cuando existe una herramienta disponible para realizar la acción.

---

# Supported Commands

Actualmente Zenith puede trabajar con comandos como:

- get_tree
- read_script
- create_script
- update_script
- create_gui
- create_instance
- get_properties
- set_properties
- find_instances
- clone_instance
- move_instance
- delete_instance
- set_attributes
- get_selection

Siempre reutilizar comandos existentes antes de crear nuevos.

---

# Future Commands

Posibles herramientas futuras:

- rename_instance
- duplicate_gui
- replace_script
- search_references
- workspace_snapshot
- compile_project_memory
- create_remote
- create_datastore
- bulk_edit
- undo
- redo

Estas herramientas aún pueden estar en desarrollo.

---

# Project Memory

En futuras versiones Zenith contará con un sistema de memoria del proyecto.

Esta memoria permitirá almacenar información organizada sobre:

- Explorer
- Scripts
- GUIs
- Sistemas
- Remotes
- Configuración
- Arquitectura

El objetivo es que Zenith no tenga que reconstruir el contexto completo del proyecto en cada conversación.

---

# Web Function

Flujo de trabajo recomendado:

1. Modificar el repositorio:

https://github.com/vx2c/Zenith

2. Realizar commit.

3. Realizar push.

4. Esperar el despliegue automático en Vercel.

Sitio web:

https://www.xzenith.net
Siempre respetar este flujo para evitar inconsistencias entre GitHub y la aplicación desplegada.

---

# Development Rules

- Nunca modificar partes del proyecto que ya funcionan correctamente sin autorización.
- Leer y comprender el código antes de implementar cambios.
- Revisar únicamente los archivos relacionados con la tarea solicitada.
- No realizar refactors innecesarios.
- No reescribir componentes completos cuando un cambio localizado sea suficiente.
- Mantener compatibilidad con el plugin existente.
- Mantener compatibilidad con el sistema de sesiones.
- Mantener compatibilidad con el sistema de comandos.
- Siempre extender la arquitectura existente en lugar de reemplazarla.
- Siempre preservar la estabilidad del proyecto.

---

# Current Priority

La prioridad actual del desarrollo NO es el plugin.

La prioridad es mejorar el comportamiento del agente para que:

- utilice herramientas de manera consistente;
- deje de inventar respuestas sobre Roblox Studio;
- ejecute comandos reales siempre que sea posible;
- espere correctamente los TOOL_RESULT antes de responder;
- se comporte como un verdadero agente similar a Cursor o GitHub Copilot Agent.

---

# Agent Execution Policy

## Mandatory Workflow

Before executing any Roblox Studio modification:

1. Inspect current project state.
2. Use get_tree or find_instances when the target location is unknown.
3. Read existing scripts before modifying them.
4. Create an execution plan.
5. Execute one tool at a time.
6. Wait for TOOL_RESULT.
7. Validate the result.
8. Continue until the entire task is complete.

The agent must never directly execute create_instance, create_script or update_script without verifying the target context first.


**Att:** `vx2c`
