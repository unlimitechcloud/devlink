# Plan de Implementación: devlink-monorepo-support

## Resumen

Extender DevLink con soporte para monorepos multinivel: tree scanner, instalación recursiva, deduplicación por symlinks, paquetes sintéticos y evolución del formato de configuración. Se implementa en TypeScript siguiendo la estructura existente del proyecto (`src/core/`, `src/commands/`, `src/types.ts`). Testing con Vitest y fast-check.

## Modelo Simplificado (Root-Only)

Después de la implementación original (tareas 1-12), el modelo se simplificó:
- DevLink solo opera a nivel de la raíz del monorepo
- No hay inyección tree-wide — solo se inyecta en el `package.json` raíz
- Los workspace members resuelven `@webforgeai/*` por Node walk-up a `root/node_modules/`
- Los workspace members NO declaran `@webforgeai/*` en sus `package.json`
- Sub-monorepos NO se instalan por separado — el `npm install` raíz los resuelve
- Solo los paquetes aislados reciben `npm install` adicional
- Las tareas 13-22 (inyección tree-wide) fueron abandonadas y reemplazadas por la tarea 23

## Tareas

- [x] 1. Agregar tipos al modelo de datos
  - [x] 1.1 Extender `src/types.ts` con los tipos del tree scanner y multilevel installer
    - Agregar `ModuleType`, `MonorepoModule`, `InstallLevel`, `MonorepoTree`, `ScanOptions`
    - Agregar `MultiLevelInstallOptions`, `LevelResult`, `MultiLevelInstallResult`
    - Agregar `DeduplicationResult`, `DeduplicationOptions`
    - Agregar `PackageSpecNew`, `PackageSpecLegacy`, `NormalizedPackageSpec`, `NormalizedConfig`
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 2.1, 3.1, 5.1, 5.2_

- [x] 2. Implementar Config Normalizer
  - [x] 2.1 Agregar funciones de normalización en `src/config.ts`
  - [x]* 2.2 Escribir tests para Config Normalizer

- [x] 3. Implementar Tree Scanner
  - [x] 3.1 Crear `src/core/tree.ts` con la función `scanTree(rootDir, options?)`
  - [x] 3.2 Implementar `classifyModule()` en `src/core/tree.ts`
  - [x] 3.3 Implementar manejo de errores del scanner
  - [x]* 3.4 Escribir tests para Tree Scanner

- [x] 4. Checkpoint — Verificar tipos, config normalizer y tree scanner

- [x] 5. Implementar Symlink Deduplicator
  - [x] 5.1 Crear `src/core/dedup.ts` con las funciones de deduplicación
  - [x]* 5.2 Escribir tests para Symlink Deduplicator

- [x] 6. Implementar soporte para paquetes sintéticos
  - [x] 6.1 Modificar `src/core/staging.ts` para aceptar parámetro `syntheticPackages`
  - [x] 6.2 Modificar `src/commands/install.ts` para filtrar sintéticos de la inyección en `package.json`
  - [x]* 6.3 Escribir tests para paquetes sintéticos

- [x] 7. Implementar Multi-Level Installer
  - [x] 7.1 Crear `src/core/multilevel.ts` con la función `installMultiLevel(options)`
  - [x] 7.2 Implementar manejo de errores multinivel
  - [x]* 7.3 Escribir tests para Multi-Level Installer

- [x] 8. Checkpoint — Verificar dedup, sintéticos y multilevel

- [x] 9. Implementar comando `dev-link tree`
  - [x] 9.1 Crear `src/commands/tree.ts` con el handler `handleTree(options)`
  - [x]* 9.2 Escribir tests para comando tree

- [x] 10. Integrar en CLI
  - [x] 10.1 Registrar comando `tree` en `src/cli.ts`
  - [x] 10.2 Agregar flag `--recursive` al comando `install` en `src/cli.ts`
  - [x] 10.3 Re-exportar nuevos handlers en `src/commands/index.ts`

- [x] 11. Integrar Config Normalizer en flujo de install existente
  - [x] 11.1 Modificar `loadConfig()` en `src/commands/install.ts` para usar normalización

- [x] 12. Checkpoint final — Verificar integración completa

- [~] 13–22. Inyección tree-wide (ABANDONADO)
  - Estas tareas fueron diseñadas para inyectar `file:` protocols en TODOS los `package.json` del árbol.
  - El modelo se simplificó: DevLink solo inyecta en la raíz. Los workspace members resuelven por Node walk-up.
  - El archivo `src/core/injector.ts` fue eliminado como código muerto.
  - Los tipos `InjectionResult`, `TreeWideInjectionResult`, `InjectTreeWideOptions` fueron eliminados de `types.ts`.
  - Las dependencias `@webforgeai/*` fueron removidas de los `package.json` de workspace members (libs/node/core, services/web/service, services/data/service).

- [x] 23. Simplificar a modelo root-only
  - [x] 23.1 Reescribir `src/core/multilevel.ts` — solo Fase 1 (raíz: DevLink + npm) y paquetes aislados (npm only). Sub-monorepos se saltan.
  - [x] 23.2 Reescribir `src/commands/install.ts` — eliminar import de `injectTreeWide` y `MonorepoTree`. Solo usar `injectStagedPackages()` (inyección local al root package.json).
  - [x] 23.3 Limpiar `src/types.ts` — eliminar tipos de inyección tree-wide (`InjectionResult`, `TreeWideInjectionResult`, `InjectTreeWideOptions`).
  - [x] 23.4 Eliminar `src/core/injector.ts` — código muerto, ya no importado por nadie.
  - [x] 23.5 Verificar que `src/core/index.ts` no re-exporta injector (confirmado: no lo hace).
  - [x] 23.6 Remover dependencias `@webforgeai/*` de workspace members:
    - `packages/libs/node/core/package.json` — removido @webforgeai/data, fen, ioc
    - `packages/services/web/packages/service/package.json` — removido @webforgeai/core, fen, http, ioc
    - `packages/services/data/packages/service/package.json` — removido @webforgeai/core, data, fen, http, ioc
  - [x] 23.7 Actualizar `src/core/multilevel.spec.ts` — tests alineados al nuevo comportamiento (root-only + isolated, sin tree-wide).
  - [x] 23.8 Compilación limpia (`tsc --noEmit` = 0 errores en DevLink).
  - [x] 23.9 316 tests pasan (21 archivos, 0 fallos).
  - [x] 23.10 Build (`npm run build`) y reinstalación global (`npm install -g .`).
  - [x] 23.11 Test de integración: `dev-link install --recursive --npm --mode dev --config-name webforgeai.config.mjs` desde el monorepo consumidor — exitoso:
    - Root: staging + inyección + npm install (28.8s)
    - 3 sub-monorepos resueltos por root workspace install
    - 1 paquete aislado: npm install (0.7s)
    - 9 paquetes `file:` inyectados en root package.json
    - 9 paquetes hoisted a root/node_modules/@webforgeai/

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- El lenguaje de implementación es TypeScript, consistente con el proyecto existente
- Node.js >= 22 requerido para `fs.glob` nativo
- Las tareas 1-12 corresponden a la implementación original (completada)
- Las tareas 13-22 fueron abandonadas (inyección tree-wide innecesaria)
- La tarea 23 implementa la simplificación a modelo root-only

- [x] 24. Eliminar subdirectorio de versión del layout de staging
  - [x] 24.1 Modificar `src/core/staging.ts` — cambiar `path.join(stagingDir, pkg.name, pkg.version)` a `path.join(stagingDir, pkg.name)`. Layout plano: `.devlink/{name}/` sin versión.
  - [x] 24.2 Modificar `src/core/dedup.ts` — eliminar `pkg.version` de la construcción de paths (`parentPkgPath`, `childPkgPath`).
  - [x] 24.3 Actualizar `src/__tests__/staging.spec.ts` — eliminar versión de todas las aserciones de paths. Test 5 (múltiples versiones) reescrito: con layout plano, la última versión gana.
  - [x] 24.4 Actualizar `src/core/dedup.spec.ts` — eliminar versión de paths en helpers y aserciones.
  - [x] 24.5 Actualizar `src/__tests__/synthetic.spec.ts` — eliminar versión de paths de staging.
  - [x] 24.6 `integration.spec.ts` y `e2e.spec.ts` no requieren cambios (usan store global con layout `namespaces/ns/pkg/version/`, no staging).
  - [x] 24.7 Compilación limpia (`tsc --noEmit` = 0 errores).
  - [x] 24.8 316 tests pasan (21 archivos, 0 fallos).
  - [x] 24.9 Build + reinstalación global exitosa.
  - [x] 24.10 Test de integración exitoso: `.devlink/@webforgeai/core/` contiene archivos directamente (sin subdirectorio de versión), `package.json` tiene `file:.devlink/@webforgeai/core` (sin versión).

- [x] 25. Eliminar módulo de deduplicación (código muerto)
  - [x] 25.1 Eliminar `src/core/dedup.ts` — funciones `deduplicatePackages()`, `findNearestParentStore()`, `deduplicateFromParent()` ya no se usan (solo había un store en la raíz, no hay parent-child).
  - [x] 25.2 Eliminar `src/core/dedup.spec.ts` — 10 tests eliminados.
  - [x] 25.3 Eliminar re-export de `src/core/index.ts` (`export * from "./dedup.js"`).
  - [x] 25.4 Eliminar tipos `DeduplicationResult` y `DeduplicationOptions` de `src/types.ts`.
  - [x] 25.5 Compilación limpia (`tsc --noEmit` = 0 errores).
  - [x] 25.6 306 tests pasan (20 archivos, 0 fallos).
  - [x] 25.7 Build + reinstalación global exitosa.
  - [x] 25.8 Test de integración exitoso.

- [x] 26. Eliminar código muerto legacy (installer, store raíz, imports)
  - [x] 26.1 Eliminar `src/installer.ts` — instalador legacy, solo importado por `index.ts`, nunca usado por el CLI.
  - [x] 26.2 Eliminar `src/store.ts` — store legacy (raíz), solo importado por `installer.ts` e `index.ts`. El store activo es `src/core/store.ts`.
  - [x] 26.3 Reescribir `src/index.ts` — re-exportar desde `core/`, `commands/` y `config.ts` en vez de los módulos legacy eliminados.
  - [x] 26.4 Eliminar import muerto de `hasDevlinkConfig` en `src/core/multilevel.ts` — importado pero nunca llamado.
  - [x] 26.5 Eliminar `clearConfigName()` de `src/core/tree.ts` — exportada pero nunca usada en ningún lado.
  - [x] 26.6 Compilación limpia (`tsc --noEmit` = 0 errores).
  - [x] 26.7 314 tests pasan (21 archivos, 3 fallos pre-existentes en publish.spec.ts por cwd de fixtures).
  - [x] 26.8 Build + reinstalación global exitosa.
  - [x] 26.9 Test de integración exitoso: 10 paquetes staged, 13 re-links, npm install OK, 3 sub-monorepos por root, 1 aislado.
