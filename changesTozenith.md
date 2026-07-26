Zenith AI Improvement Task
Objetivo principal

Mejorar Zenith AI para que tenga una comunicación estable entre:

Web Dashboard
      ↓
Zenith Backend
      ↓
Zenith Roblox Studio Plugin
      ↓
Roblox Studio

Actualmente Zenith puede ejecutar comandos correctamente, pero después de ejecutar 1-3 comandos la comunicación se corta y la conversación queda incompleta.

Ejemplo actual:

⚙️ Ejecutando search_scripts...
✅ Resultado recibido de Studio.

PLAN:
- Create a ScreenGui named ZenithGui in StarterGui.
- Add a TextButton named KillButton...

⚙️ Ejecutando create_gui...
✅ Resultado recibido de Studio.

Después de esto Zenith deja de continuar.

El objetivo es crear un sistema donde Zenith pueda mantener trabajos largos con múltiples pasos sin perder conexión.

Fase 1 - Implementar modelo IA estable con OpenRouter

Actualmente algunos modelos disponibles no responden correctamente.

Ejemplo:

All AI models are currently unavailable.
openai/gpt-oss-20b:free: empty response

Implementar OpenRouter como proveedor principal.

Requisitos:

Crear una configuración de modelos.
Permitir cambiar modelos fácilmente.
Implementar fallback automático.

Ejemplo:

Modelo principal
        ↓
Falla
        ↓
Modelo secundario
        ↓
Respuesta final

No debe detener la conversación si un modelo falla.

Fase 2 - Crear Workflow / Task System para Zenith

Zenith necesita dejar de ejecutar comandos sin planificación.

Crear un sistema de tareas:

Ejemplo:

Usuario:

Crea un sistema de dinero

Zenith debe crear:

TASK:
Create Money System

Steps:

1. Searching existing money scripts
2. Reading current leaderstats
3. Planning changes
4. Editing scripts
5. Testing changes
6. Confirming completion

Cada paso debe tener estado:

⏳ Pending
⚙️ Running
✅ Completed
❌ Failed
Fase 3 - Mejorar comunicación Web ↔ Plugin

Investigar por qué después de recibir resultados de Studio Zenith deja de continuar.

Revisar:

WebSocket
eventos enviados por el plugin
respuesta del backend
actualización del chat frontend

Agregar logs:

Plugin:

STUDIO RESPONSE:

Backend:

SERVER FORWARD:

Web:

CLIENT RECEIVED:

Encontrar exactamente dónde se pierde la respuesta.

Fase 4 - Sistema de Preview de comandos

Actualmente los comandos aparecen directamente en el chat.

Cambiar esto.

Crear una pequeña interfaz de preview integrada en el chat.

NO debe ser una ventana grande.

Debe ser una mini tarjeta.

Ejemplos:

Read Script

Mostrar:

┌─────────────────┐
│ 📄 Read Script  │
│ KillerServer    │
│ Completed ✅    │
└─────────────────┘
Get Tree

Español:

┌────────────────────┐
│ 🌳 Viendo Explorer │
│ Completed ✅       │
└────────────────────┘

Inglés:

┌────────────────────┐
│ 🌳 Looking Explorer│
│ Completed ✅       │
└────────────────────┘
Create GUI

Mostrar:

┌────────────────────┐
│ 🖼️ Creating GUI    │
│ ZenithGui          │
│ Running ⚙️         │
└────────────────────┘

La interfaz debe:

ser pequeña
usar iconos
integrarse con el diseño actual de Zenith
funcionar con Vercel
estar disponible para el frontend (no crear componentes invisibles que Vercel no pueda leer)
Fase 5 - Mejorar experiencia del chat

El chat debe diferenciar:

Respuesta IA:

Zenith:
Encontré el script.

Acción:

⚙️ Reading Script

Resultado:

✅ Script leído correctamente

No mezclar todo como texto normal.

Fase 6 - Testing

Probar trabajos largos:

Ejemplo:

Crea un sistema de dinero

Debe poder:

get_tree
search_scripts
read_script
edit_script
verify_changes
responder al usuario

Sin cortar conversación.

Finalización

Cuando todas las fases estén terminadas:

Revisar errores.
Confirmar que Zenith mantiene sesiones largas.
Hacer commit:
git add .
git commit -m "Improve Zenith AI workflow and command previews"
Hacer push directamente a la repository.