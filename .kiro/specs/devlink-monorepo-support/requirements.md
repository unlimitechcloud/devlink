# Documento de Requisitos

## Introducción

Este documento define los requisitos para extender DevLink con soporte para monorepos multinivel. Actualmente DevLink opera en un solo nivel de instalación. Esta extensión agrega: (1) un tree scanner que descubre y clasifica la estructura completa de un monorepo recursivamente, (2) instalación multinivel que ejecuta `dev-link install` en cada nivel respetando orden y fail-fast, (3) deduplicación por symlinks entre stores padre-hijo para evitar copias redundantes, (4) soporte para paquetes sintéticos que se resuelven al store pero no se instalan en `node_modules`, y (5) evolución del formato de configuración con backward compatibility.

## Glosario

- **Tree_Scanner**: Componente que descubre y clasifica la estructura de un monorepo recursivamente, produciendo un `MonorepoTree`.
- **MonorepoTree**: Estructura de datos que representa el árbol completo del monorepo: módulos, niveles de instalación y paquetes aislados.
- **MonorepoModule**: Nodo del árbol que representa un paquete descubierto, con nombre, tipo, scripts, hijos y metadata.
- **InstallLevel**: Nivel de instalación donde se ejecuta `dev-link install` o `npm install`. Ordenados: raíz → sub-monorepos → aislados.
- **Multi_Level_Installer**: Componente que orquesta la instalación de dependencias en cada nivel del monorepo secuencialmente con fail-fast.
- **Symlink_Deduplicator**: Componente que evita copias redundantes del mismo paquete@versión entre stores padre-hijo creando symlinks.
- **Config_Normalizer**: Componente que normaliza el formato de configuración (legacy y nuevo) a una estructura interna unificada.
- **Tree_Command**: Comando CLI `dev-link tree` que expone el tree scanner con salida humana o JSON.
- **Paquete_Sintético**: Paquete marcado con `synthetic: true` que se copia al store `.devlink/` pero NO se inyecta en `node_modules`.
- **Paquete_Aislado**: Paquete dentro de un sub-monorepo cuya ruta NO está cubierta por ningún glob de workspace de su padre.
- **Sub_Monorepo**: Paquete descubierto que tiene su propio campo `workspaces` en `package.json`.
- **Store_Padre**: Directorio `.devlink/` del nivel padre en la jerarquía del monorepo.
- **Store_Hijo**: Directorio `.devlink/` de un sub-monorepo o paquete aislado.
- **Formato_Legacy**: Formato de configuración actual donde cada paquete mapea modos a versiones directamente (ej: `{ dev: "0.3.0" }`).
- **Formato_Nuevo**: Formato de configuración extendido con `version` anidado y campo `synthetic` opcional (ej: `{ version: { dev: "0.3.0" }, synthetic: true }`).
- **Fail_Fast**: Estrategia donde si un nivel de instalación falla, los niveles posteriores no se ejecutan.

## Requisitos

### Requisito 1: Descubrimiento de estructura del monorepo

**User Story:** Como desarrollador, quiero que DevLink descubra automáticamente la estructura completa de mi monorepo, para no tener que configurar manualmente cada nivel de instalación.

#### Criterios de Aceptación

1. CUANDO el Tree_Scanner recibe un directorio raíz con un `package.json` que contiene campo `workspaces`, el Tree_Scanner DEBE resolver los globs de workspaces a rutas concretas y producir un MonorepoModule por cada directorio resuelto
2. CUANDO un módulo descubierto tiene un `package.json` con campo `workspaces` propio, el Tree_Scanner DEBE escanearlo recursivamente como Sub_Monorepo y poblar su lista de hijos
3. CUANDO un paquete dentro de un Sub_Monorepo no está cubierto por ningún glob de workspace del padre, el Tree_Scanner DEBE marcarlo como Paquete_Aislado (`isIsolated: true`)
4. EL Tree_Scanner DEBE producir un MonorepoTree donde `installLevels[0]` corresponde siempre a la raíz del monorepo
5. EL Tree_Scanner DEBE clasificar cada módulo con un tipo (`library`, `infrastructure`, `service`, `app`, `unknown`) usando heurísticas basadas en scripts, patrones de ruta y nombre del paquete
6. EL Tree_Scanner DEBE detectar la presencia de `devlink.config.mjs` en cada nivel y registrarlo en `hasDevlinkConfig`
7. CUANDO se especifica `maxDepth` en las opciones, el Tree_Scanner DEBE limitar la profundidad de recursión al valor indicado
8. EL Tree_Scanner DEBE exponer los nombres de scripts de cada módulo en el campo `scripts` sin hardcodear campos específicos de herramientas externas

### Requisito 2: Instalación multinivel

**User Story:** Como desarrollador, quiero ejecutar `dev-link install --recursive` y que DevLink instale dependencias en todos los niveles de mi monorepo automáticamente, para no tener que ejecutar install manualmente en cada sub-monorepo.

#### Criterios de Aceptación

1. CUANDO el usuario ejecuta `dev-link install --recursive`, el Multi_Level_Installer DEBE escanear el monorepo y ejecutar la instalación en cada InstallLevel en orden: raíz → sub-monorepos → paquetes aislados
2. CUANDO un InstallLevel tiene `hasDevlinkConfig: true`, el Multi_Level_Installer DEBE ejecutar `installPackages()` con la configuración DevLink propia de ese nivel
3. CUANDO un InstallLevel tiene `hasDevlinkConfig: false` y `runNpm` es true, el Multi_Level_Installer DEBE ejecutar solo `npm install` en ese nivel
4. SI un nivel de instalación falla, ENTONCES el Multi_Level_Installer DEBE detener la ejecución inmediatamente sin procesar niveles posteriores (Fail_Fast)
5. EL Multi_Level_Installer DEBE reportar el resultado de cada nivel incluyendo ruta, duración y estado de éxito o error
6. EL Multi_Level_Installer DEBE restaurar el directorio de trabajo al valor original después de procesar cada nivel, incluso en caso de error

### Requisito 3: Deduplicación por symlinks

**User Story:** Como desarrollador, quiero que DevLink evite copias redundantes del mismo paquete entre niveles padre-hijo, para reducir uso de disco y tiempo de instalación.

#### Criterios de Aceptación

1. CUANDO un paquete@versión declarado en la config del hijo existe en el Store_Padre, el Symlink_Deduplicator DEBE crear un symlink en el Store_Hijo apuntando a la copia del padre
2. CUANDO un paquete@versión declarado en la config del hijo no existe en el Store_Padre, el Symlink_Deduplicator DEBE indicar `deduplicated: false` y permitir la copia normal desde el store global
3. EL Symlink_Deduplicator DEBE crear directorios intermedios necesarios para paquetes con scope (ej: `@scope/nombre`)
4. EL Symlink_Deduplicator DEBE operar exclusivamente en relación padre-hijo, sin crear symlinks entre sub-monorepos al mismo nivel (siblings)
5. SI la creación de un symlink falla por permisos del filesystem, ENTONCES el Symlink_Deduplicator DEBE emitir un warning y permitir que el paquete se copie normalmente como fallback

### Requisito 4: Paquetes sintéticos

**User Story:** Como desarrollador, quiero declarar paquetes que se resuelven al store local pero no se instalan en `node_modules`, para que herramientas externas puedan consumirlos desde `.devlink/` sin contaminar el árbol de dependencias de npm.

#### Criterios de Aceptación

1. CUANDO un paquete está marcado con `synthetic: true` en la configuración, el sistema DEBE copiar el paquete al store `.devlink/` durante el staging
2. CUANDO un paquete está marcado con `synthetic: true`, el sistema DEBE excluirlo de la inyección en `package.json` como dependencia `file:`
3. CUANDO `dev-link install` completa, los Paquetes_Sintéticos DEBEN existir en `.devlink/` pero NO en `node_modules/`

### Requisito 5: Normalización de configuración con backward compatibility

**User Story:** Como desarrollador, quiero que DevLink soporte un formato de configuración extendido con `synthetic` y `version` anidado, manteniendo compatibilidad con mi configuración actual, para poder migrar gradualmente.

#### Criterios de Aceptación

1. CUANDO el Config_Normalizer recibe un paquete en Formato_Nuevo (`{ version: { dev: "0.3.0" }, synthetic?: true }`), el Config_Normalizer DEBE normalizarlo a la estructura interna unificada preservando versiones y flag synthetic
2. CUANDO el Config_Normalizer recibe un paquete en Formato_Legacy (`{ dev: "0.3.0" }`), el Config_Normalizer DEBE normalizarlo a la estructura interna con `synthetic: false` por defecto
3. EL Config_Normalizer DEBE producir la misma versión resuelta para un modo dado, independientemente de si el paquete usa Formato_Nuevo o Formato_Legacy
4. CUANDO el config contiene la propiedad `detectMode`, el Config_Normalizer DEBE ignorarla sin generar error
5. SI un paquete tiene un formato no reconocido (ni legacy ni nuevo), ENTONCES el Config_Normalizer DEBE lanzar un error descriptivo indicando el nombre del paquete y el formato encontrado
6. EL Config_Normalizer DEBE rechazar configs que mezclen Formato_Nuevo y Formato_Legacy dentro del mismo archivo

### Requisito 6: Comando `dev-link tree`

**User Story:** Como desarrollador o herramienta externa, quiero ejecutar `dev-link tree` para visualizar la estructura de mi monorepo, y `dev-link tree --json` para consumir la estructura programáticamente.

#### Criterios de Aceptación

1. CUANDO el usuario ejecuta `dev-link tree`, el Tree_Command DEBE mostrar una representación visual del árbol con nombre, tipo y ruta relativa de cada módulo
2. CUANDO el usuario ejecuta `dev-link tree --json`, el Tree_Command DEBE imprimir el MonorepoTree como JSON válido a stdout
3. CUANDO el usuario especifica `--depth N`, el Tree_Command DEBE limitar la profundidad de escaneo al valor N
4. EL Tree_Command DEBE mostrar un resumen con cantidad de módulos, niveles de instalación y paquetes aislados
5. CUANDO se usa `--json`, el Tree_Command DEBE usar stderr para mensajes de error, sin contaminar stdout

### Requisito 7: Manejo de errores

**User Story:** Como desarrollador, quiero que DevLink maneje errores de forma clara y recuperable durante el escaneo e instalación multinivel, para poder diagnosticar y resolver problemas rápidamente.

#### Criterios de Aceptación

1. SI el directorio raíz no contiene un `package.json`, ENTONCES el Tree_Scanner DEBE mostrar un mensaje de error indicando que se esperaba un `package.json` con campo `workspaces`
2. CUANDO un glob de workspace no resuelve a ningún directorio, el Tree_Scanner DEBE emitir un warning sin detener la ejecución
3. SI `npm install` retorna un código de salida distinto de cero en algún nivel, ENTONCES el Multi_Level_Installer DEBE mostrar el error, el nivel afectado, y detener la ejecución
4. SI el modo solicitado no tiene factory definida en la configuración, ENTONCES el sistema DEBE mostrar un error indicando los modos disponibles
