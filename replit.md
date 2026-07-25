# Zenith

## About

Zenith es un asistente de IA diseñado para integrarse con proyectos de Roblox Studio mediante un conector. Este conector funciona a través de un plugin de Roblox Studio, el cual permite establecer una conexión entre Zenith y el proyecto.

Una vez conectado, el plugin envía solicitudes (ping) a la aplicación web para mantener la comunicación activa y permitir que Zenith interactúe con el proyecto en tiempo real.

## Plugin Code

El código principal del plugin se encuentra en:

`plugin/IAConector.plugin.lua`

## Important Folders

### Folder 1 - `api`

Este directorio contiene los siguientes archivos:

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

### Folder 2

* `artifacts`
* `api-server`
* `mockup-sandbox`
* `zenith`

### Folder 3

* `lib`
* `api-client-react`
* `api-spec`
* `api-zod`
* `db`

### Folder 4

* `scripts`
* `src`

Archivos principales:

* `package.json`
* `post-merge.sh`
* `tsconfig.json`

### Folder 5 - `.migration-backup`

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

## Web Function

Flujo de trabajo recomendado:

1. Modificar el repositorio:

   * `https://github.com/vx2c/Zenith`

2. Realizar un commit y push de los cambios.

3. Vercel detectará automáticamente los nuevos commits y actualizará el sitio:

   * `https://xzenith.vercel.app`

> Es importante seguir siempre este orden para evitar inconsistencias entre el repositorio y la aplicación desplegada.

## Important Notes

* Nunca modificar partes del proyecto que ya funcionan correctamente, a menos que se haya solicitado explícitamente.
* Antes de realizar cambios, leer y comprender cómo funciona el sistema.
* Revisar únicamente las carpetas necesarias para la tarea asignada.
* No realizar modificaciones no autorizadas.
* Siempre hacer preguntas e informarse antes de implementar cambios.
* Mantener un orden específico durante el desarrollo y la documentación.

Este proyecto lleva varios días de desarrollo y debe tratarse con cuidado. No es un proyecto para realizar cambios aleatorios en cualquier archivo sin haber revisado previamente su funcionamiento.

La prioridad es mantener la estabilidad, la organización y la compatibilidad entre el plugin, la web y el sistema de comunicación.

**Att:** `vx2c`
