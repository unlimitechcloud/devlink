# Plan de Implementación: devlink-monorepo-support

## Resumen

Extender DevLink con soporte para monorepos multinivel: tree scanner, instalación recursiva, deduplicación por symlinks, paquetes sintéticos y evolución del formato de configuración. Se implementa en TypeScript siguiendo la estructura existente del proyecto (`src/core/`, `src/commands/`, `src/types.ts`). Testing con Vitest y fast-check.

## Tareas

- [ ] 1. Agregar tipos al modelo de datos
  - [ ] 1.1 Extender `src/types.ts` con los tipos del tree scanner y multilevel installer
    - Agregar `ModuleType`, `MonorepoModule`, `InstallLevel`, `MonorepoTree`, `ScanOptions`
    - Agregar `MultiLevelInstallOptions`, `LevelResult`, `MultiLevelInstallResult`
    - Agregar `DeduplicationResult`, `DeduplicationOptions`
    - Agregar `PackageSpecNew`, `PackageSpecLegacy`, `NormalizedPackageSpec`, `NormalizedConfig`
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 2.1, 3.1, 5.1, 5.2_

- [ ] 2. Implementar Config Normalizer
  - [ ] 2.1 Agregar funciones de normalización en `src/config.ts`
    - Implementar `isNewFormat(spec)` y `isLegacyFormat(spec)` para detección de formato
    - Implementar `normalizeConfig(raw)` que convierte ambos formatos a `NormalizedConfig`
    - Ignorar `detectMode` si existe (deprecado)
    - Rechazar mezcla de formatos legacy y nuevo en el mismo config
    - Lanzar error descriptivo para formatos no reconocidos
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [ ]* 2.2 Escribir tests para Config Normalizer
    - Test: formato nuevo produce `NormalizedConfig` con versiones y synthetic correctos
    - Test: formato legacy produce `NormalizedConfig` con `synthetic: false`
    - Test: ambos formatos producen la misma versión resuelta para un modo dado
    - Test: `detectMode` se ignora sin error
    - Test: formato no reconocido lanza error con nombre del paquete
    - Test: mezcla de formatos lanza error
    - _Valida: Requisitos 5.1–5.6, Propiedades 12, 13_

- [ ] 3. Implementar Tree Scanner
  - [ ] 3.1 Crear `src/core/tree.ts` con la función `scanTree(rootDir, options?)`
    - Leer `package.json` raíz y resolver globs de `workspaces` con `fs.glob` (Node 22+)
    - Recorrer cada workspace y detectar sub-monorepos (package.json con workspaces propios)
    - Escanear recursivamente hijos de sub-monorepos respetando `maxDepth`
    - Detectar paquetes aislados: directorios con `package.json` no cubiertos por globs del padre
    - Detectar presencia de `devlink.config.mjs` en cada nivel (`hasDevlinkConfig`)
    - Producir `installLevels` ordenados: raíz → sub-monorepos → aislados
    - Exponer `scripts` genéricos (sin campos hardcodeados de herramientas externas)
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8_
  - [ ] 3.2 Implementar `classifyModule()` en `src/core/tree.ts`
    - Clasificar por heurísticas: scripts de infraestructura, path patterns, nombre del paquete, nombre del directorio
    - Retornar `ModuleType` (`library`, `infrastructure`, `service`, `app`, `unknown`)
    - _Requisito: 1.5_
  - [ ] 3.3 Implementar manejo de errores del scanner
    - Error si `package.json` raíz no existe o no tiene `workspaces`
    - Warning (no fatal) si un glob no resuelve a ningún directorio
    - _Requisitos: 7.1, 7.2_
  - [ ]* 3.4 Escribir tests para Tree Scanner
    - Test con fixture de monorepo mínimo: raíz + workspaces + sub-monorepo + paquete aislado
    - Test: `installLevels[0]` es siempre la raíz
    - Test: sub-monorepos se escanean recursivamente
    - Test: paquetes aislados se detectan correctamente
    - Test: `maxDepth` limita la recursión
    - Test: clasificación de módulos por heurísticas
    - Test: error cuando no hay `package.json` raíz
    - _Valida: Requisitos 1.1–1.8, Propiedades 1–6_

- [ ] 4. Checkpoint — Verificar tipos, config normalizer y tree scanner
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [ ] 5. Implementar Symlink Deduplicator
  - [ ] 5.1 Crear `src/core/dedup.ts` con las funciones de deduplicación
    - Implementar `deduplicatePackages(options)`: para cada paquete@versión, verificar si existe en store padre → crear symlink o indicar `deduplicated: false`
    - Implementar `findNearestParentStore(startDir, rootDir)`: scan upward buscando `.devlink/`
    - Implementar `deduplicateFromParent(rootDir, childDir, mode)`: orquesta carga de config hijo + deduplicación
    - Crear directorios intermedios para scoped packages (`@scope/`)
    - Fallback a copia si symlink falla por permisos (warning, no error)
    - Solo relación padre-hijo, nunca entre siblings
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ]* 5.2 Escribir tests para Symlink Deduplicator
    - Test: symlink se crea cuando paquete existe en padre
    - Test: `deduplicated: false` cuando no existe en padre
    - Test: directorios intermedios para scoped packages
    - Test: no se crean symlinks entre siblings
    - Test: fallback a copia cuando symlink falla
    - _Valida: Requisitos 3.1–3.5, Propiedades 7, 8, 9, 10_

- [ ] 6. Implementar soporte para paquetes sintéticos
  - [ ] 6.1 Modificar `src/core/staging.ts` para aceptar parámetro `syntheticPackages`
    - Los paquetes sintéticos SÍ se copian a `.devlink/` (staging)
    - Los paquetes sintéticos NO se incluyen en el resultado de staged para inyección
    - _Requisito: 4.1_
  - [ ] 6.2 Modificar `src/commands/install.ts` para filtrar sintéticos de la inyección en `package.json`
    - Usar `NormalizedConfig` para identificar paquetes con `synthetic: true`
    - Excluir sintéticos de `injectStagedPackages()` (no inyectar como `file:` deps)
    - Los sintéticos quedan en `.devlink/` pero no en `node_modules/`
    - _Requisitos: 4.2, 4.3_
  - [ ]* 6.3 Escribir tests para paquetes sintéticos
    - Test: sintético existe en `.devlink/` después de install
    - Test: sintético NO aparece en `package.json` como `file:` dep
    - _Valida: Requisitos 4.1–4.3, Propiedad 11_

- [ ] 7. Implementar Multi-Level Installer
  - [ ] 7.1 Crear `src/core/multilevel.ts` con la función `installMultiLevel(options)`
    - Fase 1: instalar en raíz (siempre primero)
    - Fase 2: para cada sub-monorepo, deduplicar desde padre y luego instalar
    - Fase 3: instalar en paquetes aislados
    - Fail-fast: si un nivel falla, no ejecutar posteriores
    - Restaurar `process.cwd()` después de cada nivel (try/finally)
    - Reportar resultado por nivel con duración en milisegundos
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [ ] 7.2 Implementar manejo de errores multinivel
    - Error de npm install: mostrar nivel afectado y detener ejecución
    - Error de modo no definido: mostrar modos disponibles
    - _Requisitos: 7.3, 7.4_
  - [ ]* 7.3 Escribir tests para Multi-Level Installer
    - Test: niveles se procesan en orden raíz → sub-monorepos → aislados
    - Test: fail-fast detiene ejecución en nivel fallido
    - Test: `cwd` se restaura después de cada nivel
    - Test: niveles con config DevLink usan `installPackages()`, sin config usan `npm install`
    - _Valida: Requisitos 2.1–2.6, Propiedades 3, 7, 8_

- [ ] 8. Checkpoint — Verificar dedup, sintéticos y multilevel
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [ ] 9. Implementar comando `dev-link tree`
  - [ ] 9.1 Crear `src/commands/tree.ts` con el handler `handleTree(options)`
    - Invocar `scanTree()` desde el directorio actual
    - Modo `--json`: imprimir `MonorepoTree` como JSON a stdout
    - Modo normal: imprimir árbol visual con nombre, tipo y ruta relativa
    - Mostrar resumen: cantidad de módulos, niveles de instalación, paquetes aislados
    - Usar stderr para errores en modo JSON (no contaminar stdout)
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 9.2 Escribir tests para comando tree
    - Test: salida JSON es parseable y contiene todos los módulos
    - Test: salida visual contiene nombre, tipo y ruta de cada módulo
    - Test: `--depth` limita la profundidad
    - _Valida: Requisitos 6.1–6.5, Propiedades 14, 15_

- [ ] 10. Integrar en CLI
  - [ ] 10.1 Registrar comando `tree` en `src/cli.ts`
    - Agregar comando `tree` con opciones `--json` y `--depth <n>`
    - Importar `handleTree` desde `src/commands/tree.ts`
    - _Requisito: 6.1_
  - [ ] 10.2 Agregar flag `--recursive` al comando `install` en `src/cli.ts`
    - Cuando `--recursive` está presente, usar `installMultiLevel()` en lugar de `installPackages()`
    - Pasar opciones existentes (`--mode`, `--npm`, `--run-scripts`) al multilevel installer
    - _Requisito: 2.1_
  - [ ] 10.3 Re-exportar nuevos handlers en `src/commands/index.ts`
    - Exportar `handleTree` desde `src/commands/tree.ts`
    - _Requisito: 6.1_

- [ ] 11. Integrar Config Normalizer en flujo de install existente
  - [ ] 11.1 Modificar `loadConfig()` en `src/commands/install.ts` para usar normalización
    - Detectar formato de config (nuevo vs legacy) al cargar
    - Normalizar a formato interno antes de procesar paquetes
    - Pasar `syntheticPackages` Set al flujo de staging/inyección
    - Ignorar `detectMode` cuando `--mode` viene del CLI
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

- [ ] 12. Checkpoint final — Verificar integración completa
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.
  - Verificar que `dev-link tree` produce salida correcta en monorepo de prueba
  - Verificar que `dev-link tree --json` produce JSON parseable
  - Verificar que `dev-link install --recursive --npm --mode dev` procesa todos los niveles
  - Verificar que paquetes sintéticos quedan en `.devlink/` pero no en `node_modules/`
  - Verificar que el formato legacy de config sigue funcionando sin cambios

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- El lenguaje de implementación es TypeScript, consistente con el proyecto existente
- La librería de property-based testing recomendada es fast-check (agregar como devDependency)
- Node.js >= 22 requerido para `fs.glob` nativo
- Los tests usan fixtures de monorepo en memoria (memfs o tmpdir)
