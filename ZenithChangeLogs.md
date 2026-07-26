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
