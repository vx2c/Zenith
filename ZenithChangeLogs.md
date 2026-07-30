# Zenith — Validation Log

Registro de evidencia para validar (o refutar) hipótesis sobre el comportamiento del
agent loop en `chat.js`. A diferencia de `ZenithChangeLogs.md` (que documenta cambios
ya aplicados), este archivo documenta **casos de prueba y su evidencia**, antes y
después de que un fix se despliegue — para poder comparar comportamiento real contra
lo esperado.

Formato por entrada: escenario → evidencia observada → conclusión → qué hipótesis
prueba → estado de validación.

---

## Evidencia #1 — "Investigación sin escritura, declarado completo"

**Fecha:** 2026-07-30 (reportado por el usuario; fecha de la prueba en sí no confirmada)

**Estado respecto a la Capa 3:** ⚠️ **Pendiente de confirmar si corresponde a antes o
después del deploy de la Capa 3 (autoevaluación `[x]`/`[ ]`).** Esto importa porque si
la Capa 3 ya estaba desplegada durante esta prueba y aun así no se disparó, sería
evidencia de un problema distinto (ver "Preguntas abiertas" abajo).

### Lo confirmado (tal como lo reportó el usuario)

- Zenith **no falló técnicamente** — no hubo error de red, ni excepción, ni timeout.
- El plugin **nunca recibió ninguna tool de escritura** (`create_*`, `edit_*`/`update_*`)
  durante toda la tarea — confirmado por logs del lado del plugin, no solo por la UI
  del chat.
- El modelo completó lo que el usuario describe como una **"fase de investigación"**
  (lectura de scripts/árbol, sin especificar aún exactamente qué tools se ejecutaron)
  y luego **declaró la tarea finalizada** sin haber ejecutado ninguna escritura.

### Conclusión que esto respalda

Esto descarta dos categorías de causa que investigamos en sesiones anteriores:

1. **No es un problema de ejecución** — el plugin funcionó correctamente, no hubo
   fallos de comunicación ni de comandos mal formados llegando al plugin.
2. **No es un problema de "reportó éxito parcial como total"** — no hubo ejecución de
   ningún tipo que reportar, ni parcial ni total.

Y confirma, en cambio, la categoría de causa que sí veníamos rastreando: **el criterio
para aceptar "Workspace task complete" en tareas compuestas es insuficiente** — el
modelo puede declarar terminado un objetivo de investigación+construcción habiendo
completado solo la mitad (investigación), sin que el sistema se lo impida.

### Qué hipótesis prueba

Relacionado directamente con `readOnlyDespiteWriteIntent` (el chequeo que ya existía
para "se leyó pero nunca se escribió nada") y con la Capa 3 (autoevaluación
obligatoria para checklists de 3+ items). Es exactamente el tipo de caso que la Capa 3
fue diseñada para atrapar.

### Preguntas abiertas — necesarias para que esta evidencia sea concluyente

- [ ] ¿Esta prueba corrió **antes o después** del deploy de la Capa 3? Si fue antes,
      esto es evidencia del *problema*, no todavía evidencia de que el *fix* funcione
      o falle.
- [ ] ¿Cuántos `pendingSteps` tenía la tarea en el momento en que el modelo intentó
      parar? La Capa 3 solo se dispara con `>= 3`. Si el pedido generó menos de 3
      (por ejemplo, si `detectCompoundDeliverables()` solo detectó 1-2 categorías, o
      el modelo nunca escribió un `PLAN:` numerado), la Capa 3 **no se habría
      activado** — y eso sería una evidencia distinta y también importante (el
      detector previo a la Capa 3 sigue siendo insuficiente para casos que ni
      siquiera llegan a generar checklist).
- [ ] ¿Cuál fue el pedido original exacto y qué tools de lectura se ejecutaron en la
      "fase de investigación"?
- [ ] ¿El `taskStatus` final se reportó como `'completed'` o como `'incomplete'`? (El
      chequeo `readOnlyDespiteWriteIntent` ya existente debería, en teoría, marcarlo
      `'incomplete'` si `anyWriteIntent` era verdadero para el pedido original —
      confirmar si esto se cumplió o si esa es otra grieta.)

### Próximo paso para cerrar esta evidencia

Repetir el mismo escenario (mismo tipo de pedido: objetivo compuesto que requiere
investigación previa a la escritura) **con la Capa 3 ya desplegada**, confirmando el
conteo de `pendingSteps` en el momento del intento de cierre, y registrar el resultado
como continuación de esta entrada.

---

## Cómo agregar la próxima evidencia

Copiar el formato de arriba. Mantener siempre la separación entre "lo confirmado"
(hechos verificables en logs) y "lo inferido" (conclusiones que dependen de datos que
todavía no se registraron). No marcar una hipótesis como validada o refutada sin al
menos una repetición confirmada.
