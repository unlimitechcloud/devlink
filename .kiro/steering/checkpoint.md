---
inclusion: manual
---

# Checkpoint — Guía para AI Assistants

Instrucciones para crear un checkpoint de desarrollo: recopilar cambios, actualizar changelog, commit y push.

## Cuándo usar

Activar este steering cuando el usuario pida:
- "Hacer un checkpoint"
- "Commit de lo que llevamos"
- "Guardar el progreso"
- "Actualizar changelog y commit"

## Contexto del Proyecto

DevLink (`@unlimitechcloud/devlink`) es un paquete único (no monorepo). El código fuente está en `src/` con esta estructura:

```
src/
├── cli.ts              # CLI entry point
├── config.ts           # Configuration utilities
├── constants.ts        # Paths, defaults
├── types.ts            # TypeScript type definitions
├── index.ts            # Library exports
├── commands/           # Command handlers (install, publish, push, etc.)
├── core/               # Core logic (lock, registry, resolver, staging, etc.)
└── formatters/         # Output formatters (tree, flat)
```

El changelog es un único `CHANGELOG.md` en la raíz. Los tests están en `src/**/*.spec.ts`.

## Secuencia de Checkpoint

### Paso 1: Revisar cambios pendientes

```bash
git status
git diff --stat
```

Identificar todos los archivos modificados, agregados o eliminados.

### Paso 2: Ejecutar tests

```bash
npm test
```

Si hay tests fallando, informar al usuario antes de continuar. No hacer checkpoint con tests rotos salvo que el usuario lo autorice explícitamente.

### Paso 3: Leer el CHANGELOG.md actual

Leer las primeras ~30 líneas del `CHANGELOG.md` para entender la última versión y la sección `[Unreleased]` si existe.

### Paso 4: Redactar entradas del changelog

Agregar entradas en la sección `[Unreleased]` (crearla si no existe, justo después del header del archivo) siguiendo el formato Keep a Changelog:

- **Added**: nuevas funcionalidades
- **Changed**: cambios en funcionalidades existentes
- **Fixed**: correcciones de bugs
- **Removed**: funcionalidades eliminadas

### Formato de entradas

Cada entrada debe:
1. Empezar con el nombre del feature/función/concepto clave
2. Incluir una descripción concisa de qué hace o qué cambió
3. Opcionalmente, sub-items con detalles relevantes

### Ejemplo de entradas

```markdown
## [Unreleased]

### Added
- `link` attribute for packages in config: packages with `link` skip store/npm resolution and are resolved via `npm link` after install
  - Support in all three install flows: no-mode, mode+npm (staging), and direct copy
  - `linked` field in `InstallResult` to track successfully linked packages

### Changed
- `loadConfig()` API: now accepts optional `mode` parameter instead of auto-detecting from `process.argv`

### Fixed
- Staging directory (`.devlink/`) is now fully cleaned at the start of every `installPackages()` run

### Removed
- `--dev` and `--prod` CLI flags: use `--mode dev` or `--mode prod` instead
```

### Paso 5: Stage y commit

```bash
git add -A
git commit -m "<type>: <descripción concisa>"
```

Tipos de commit:
- `feat`: nueva funcionalidad
- `fix`: corrección de bug
- `refactor`: refactorización sin cambio de comportamiento
- `docs`: solo documentación
- `chore`: mantenimiento, dependencias
- `test`: solo tests

No usar scope entre paréntesis — DevLink es un paquete único.

### Paso 6: Push

```bash
git push
```

Si hay conflictos o el push falla, informar al usuario.

## Notas importantes

- No incluir cambios de archivos de test o fixtures en el changelog (salvo que sean tests que validan un fix importante)
- La sección `[Unreleased]` se convierte en una versión específica durante el release (ver `release.md`)
- Si los cambios son triviales (typos, formatting), un solo bullet basta
- Si hay muchos cambios, agruparlos lógicamente bajo las categorías correctas
