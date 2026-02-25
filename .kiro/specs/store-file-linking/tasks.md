# Tareas de Implementación: Store File Linking

## Task 1: Eliminar manager proxy y código asociado
- [x] Eliminar archivos del proxy: `src/proxy/server.ts`, `src/proxy/npm-delegate.ts`, `src/proxy/tarball.ts`, `src/proxy/lifecycle.ts`, `src/proxy/project-lock.ts`, `src/proxy/npmrc.ts`
- [x] Eliminar el directorio `src/proxy/`
- [x] Eliminar archivo de tests `src/__tests__/proxy.spec.ts`
- [x] En `src/types.ts`: cambiar `manager: "store" | "npm" | "proxy"` a `manager: "store" | "npm"` en `ModeConfig`
- [x] En `src/types.ts`: eliminar la propiedad `peerOptional` de `ModeConfig` y su JSDoc
- [x] En `src/commands/install.ts`: eliminar la función `installViaProxy` y todo su código
- [x] En `src/commands/install.ts`: eliminar el bloque `if (modeConfig.manager === "proxy")` que llama a `installViaProxy`
- [x] En `src/commands/install.ts`: eliminar las funciones `stripPackagesFromPackageJson`, `injectPackagesIntoPackageJson` (serán reemplazadas), `runNpmInstallNoAudit`
- [x] En `src/commands/install.ts`: eliminar los imports de `src/proxy/*` (`acquireProjectLock`, `findFreePort`, `startProxy`, `stopProxy`, `writeProxyNpmrc`, `restoreNpmrc`)
- [x] En `src/commands/install.ts`: eliminar el import de `os`
- [x] En `src/commands/install.ts`: eliminar las funciones `matchesPattern`, `matchesAnyPattern`, `applyPeerOptional` (ya no se necesitan sin `peerOptional`)
- [x] En `src/commands/install.ts`: eliminar el parámetro `peerOptionalPatterns` de la función `linkPackage`
- [x] Verificar que no queden imports rotos ni referencias al proxy en ningún archivo con `npm run build`

### Requisitos cubiertos
- Requisito 5: Eliminación del manager proxy (AC 1-5)

## Task 2: Agregar dependencia semver
- [x] Ejecutar `npm install semver` en el directorio de DevLink
- [x] Ejecutar `npm install -D @types/semver` para los tipos TypeScript
- [x] Verificar que `semver` aparece en `dependencies` del `package.json`
- [x] Verificar que `@types/semver` aparece en `devDependencies` del `package.json`

### Requisitos cubiertos
- Requisito 8: Dependencia semver (AC 1-2)

## Task 3: Crear módulo de staging (`src/core/staging.ts`)
- [x] Crear archivo `src/core/staging.ts`
- [x] Definir constante `STAGING_DIR = ".devlink"`
- [x] Definir interfaces: `StagingResult`, `StagedPackage`, `RelinkDetail`
- [ ] Implementar función `stageAndRelink(projectPath, resolvedPackages)`:
  - Limpiar `.devlink/` existente con `fs.rm(stagingDir, { recursive: true, force: true })`
  - Recrear `.devlink/` con `fs.mkdir(stagingDir, { recursive: true })`
  - Copiar cada paquete resuelto del store a `.devlink/{name}/{version}/` usando copia recursiva
  - Construir índice `Map<string, { version: string; path: string }[]>` de paquetes disponibles en staging
  - Para cada paquete en staging, leer `package.json` y reescribir `dependencies` y `peerDependencies` internas a `file:` paths relativos usando `semver.maxSatisfying()` para resolver rangos
  - No modificar `devDependencies`
  - No modificar dependencias externas (no presentes en staging)
  - Escribir `package.json` modificado solo si hubo cambios
  - Retornar `StagingResult` con detalle de paquetes staged y deps relinked
- [x] Exportar `stageAndRelink`, `STAGING_DIR`, y las interfaces desde el módulo

### Requisitos cubiertos
- Requisito 1: Staging local de paquetes resueltos (AC 1-4)
- Requisito 2: Re-link de dependencias internas en staging (AC 1-5)
- Requisito 6: Resolución semver en el staging (AC 1-3)

## Task 4: Implementar inyección de file: dependencies y flujo npm install
- [x] En `src/commands/install.ts`: agregar imports de `stageAndRelink`, `STAGING_DIR` desde `../core/staging.js`
- [x] En `src/commands/install.ts`: agregar import de `path`
- [x] Crear función `injectStagedPackages(projectPath, stagedPackages)`:
  - Leer `package.json` del proyecto y guardar contenido original como backup
  - Para cada paquete staged, inyectar como `"file:.devlink/{name}/{version}"` en `dependencies`
  - Escribir `package.json` modificado
  - Retornar `PackageJsonBackup` (reutilizar la interfaz existente)
- [x] Crear función `restorePackageJson(backup)` (simplificada, reutilizar la existente si quedó)
- [x] Modificar la función `runNpmInstall` para usar `--no-audit --legacy-peer-deps` como flags por defecto
- [x] Modificar el flujo de `installPackages` cuando `options.runNpm === true` y `modeConfig.manager === "store"`:
  - En lugar del flujo actual (copiar a node_modules + npm install después), usar el nuevo flujo:
    1. Resolver paquetes cross-namespace (ya existe)
    2. Llamar `stageAndRelink(projectPath, resolvedPackages)`
    3. Llamar `injectStagedPackages(projectPath, staging.staged)`
    4. En bloque `try/finally`: ejecutar `npm install`, luego restaurar `package.json`
    5. Actualizar `devlink.lock` e `installations.json`
  - Registrar signal handlers para SIGINT/SIGTERM que restauren `package.json`
- [x] Mantener el flujo sin `--npm` intacto (copia directa a node_modules)
- [x] Verificar que compila con `npm run build`

### Requisitos cubiertos
- Requisito 3: Instalación con inyección de file: dependencies (AC 1-5)
- Requisito 4: Restauración garantizada del package.json (AC 1-3)
- Requisito 7: Compatibilidad con flujo store existente (AC 1-3)

## Task 5: Tests unitarios para staging y re-link
- [x] Crear archivo `src/__tests__/staging.spec.ts`
- [x] Test: `stageAndRelink` copia paquetes correctamente al staging
  - Crear fixtures con paquetes de prueba en un store temporal
  - Verificar que `.devlink/{name}/{version}/` contiene los archivos copiados
- [x] Test: `stageAndRelink` reescribe dependencias internas a `file:` paths relativos
  - Paquete A depende de B (ambos en staging) → A.package.json tiene B como `file:` path
- [x] Test: `stageAndRelink` no modifica dependencias externas
  - Paquete A depende de `express` → queda como `^4.18.0`
- [x] Test: `stageAndRelink` maneja cross-namespace (paquetes de distintos namespaces)
  - Paquete A de `global`, paquete B de `feature-v2`, A depende de B → se linkean correctamente
- [x] Test: `stageAndRelink` usa `semver.maxSatisfying` para resolver rangos
  - Paquete con dep `^1.0.0`, staging tiene `1.0.0` y `1.2.0` → selecciona `1.2.0`
- [x] Test: `stageAndRelink` no modifica `devDependencies`
- [x] Test: `injectStagedPackages` inyecta paths relativos correctos
- [x] Test: `restorePackageJson` restaura contenido exacto
- [x] Verificar que todos los tests pasan con `npm test`

### Requisitos cubiertos
- Requisito 1 (AC 1-4), Requisito 2 (AC 1-5), Requisito 6 (AC 1-3)

## Task 6: Build final y verificación
- [x] Ejecutar `npm run build` y verificar que compila sin errores
- [x] Ejecutar `npm test` y verificar que todos los tests pasan
- [x] Verificar que no quedan referencias al proxy en el código fuente (buscar "proxy" en `src/`)
- [x] Verificar que `devlink install --dev` (sin --npm) sigue funcionando con el flujo de copia directa a node_modules

### Requisitos cubiertos
- Requisito 5 (AC 1-5), Requisito 7 (AC 1-2)
