# Documento de Requisitos: Store File Linking

## Introducción

DevLink actualmente soporta tres managers de instalación: `store`, `npm` y `proxy`. El manager `proxy` resultó excesivamente complejo. Esta feature reemplaza el proxy con una solución más simple: mejorar el manager `store` para que soporte instalación vía `npm install` usando el protocolo `file:` nativo de npm.

El enfoque usa staging local en el proyecto: (1) resolver paquetes cross-namespace desde el store, (2) copiarlos a `.devlink/` en el proyecto, (3) re-linkear dependencias internas con `file:` paths relativos dentro de `.devlink/`, y (4) inyectar los paquetes como `file:` dependencies en el `package.json` del proyecto antes de correr `npm install`.

## Glosario

- **Store**: Repositorio local centralizado de paquetes DevLink (`~/.devlink/`). Read-only durante install.
- **Staging**: Carpeta `.devlink/` dentro del proyecto donde se copian y procesan los paquetes resueltos.
- **Re-link**: Proceso de reescritura de dependencias internas a paths `file:` relativos dentro del staging.
- **Namespace**: Contenedor aislado de paquetes dentro del store (ej: `global`, `feature-branch`).
- **Cross-namespace**: Resolución de paquetes que busca en múltiples namespaces con precedencia configurada.
- **Registry**: Índice de metadatos de paquetes publicados (`registry.json`).
- **File_Protocol**: Protocolo nativo de npm (`file:`) que permite referenciar paquetes locales por path.
- **Inyección**: Proceso temporal de agregar paquetes del staging como `file:` dependencies en el `package.json` del proyecto.
- **Semver_Range**: Rango de versiones semántico (ej: `^0.1.0`, `~1.2.0`) usado en dependencias npm.
- **DevLink_CLI**: Interfaz de línea de comandos de DevLink.
- **Installations_Registry**: Archivo `installations.json` que rastrea qué proyectos han instalado paquetes del store.
- **Lockfile**: Archivo `devlink.lock` en el proyecto consumidor que registra paquetes instalados con sus signatures.

## Requisitos

### Requisito 1: Staging local de paquetes resueltos

**User Story:** Como desarrollador de un SDK con múltiples paquetes en distintos namespaces, quiero que al ejecutar `devlink install --dev --npm` los paquetes se resuelvan cross-namespace y se copien a una carpeta `.devlink/` en mi proyecto, para que el re-link ocurra en un contexto local con todos los paquetes ya resueltos.

#### Criterios de Aceptación

1. WHEN el DevLink_CLI ejecuta `install` con manager `store` y flag `--npm`, THE DevLink_CLI SHALL resolver cada paquete del config usando la precedencia de namespaces configurada (cross-namespace)
2. WHEN los paquetes son resueltos, THE DevLink_CLI SHALL limpiar el directorio `.devlink/` existente en el proyecto y recrearlo
3. WHEN los paquetes son copiados al staging, THE DevLink_CLI SHALL copiar cada paquete resuelto del store a `.devlink/{packageName}/{version}/` preservando la estructura de archivos
4. THE Store SHALL permanecer sin modificaciones durante todo el proceso de install (read-only)

### Requisito 2: Re-link de dependencias internas en staging

**User Story:** Como desarrollador, quiero que las dependencias internas entre paquetes del staging se reescriban automáticamente a paths `file:` relativos, para que npm pueda resolver el árbol de dependencias completo usando el protocolo `file:`.

#### Criterios de Aceptación

1. WHEN los paquetes están copiados en el staging, THE DevLink_CLI SHALL escanear cada paquete y reescribir las dependencias internas (presentes en staging) a paths File_Protocol relativos
2. WHEN el DevLink_CLI evalúa si una dependencia del staging satisface un Semver_Range, THE DevLink_CLI SHALL usar `semver.satisfies()` para validar y `semver.maxSatisfying()` para seleccionar la mejor versión disponible
3. WHEN el DevLink_CLI encuentra una dependencia que NO existe en el staging o NO satisface el Semver_Range, THE DevLink_CLI SHALL dejar esa dependencia sin modificar (con su valor original del registry)
4. WHEN el DevLink_CLI procesa dependencias, THE DevLink_CLI SHALL procesar únicamente los campos `dependencies` y `peerDependencies`, excluyendo `devDependencies`
5. WHEN paquetes provienen de distintos namespaces, THE DevLink_CLI SHALL linkearlos correctamente entre sí dentro del staging (cross-namespace linking)

### Requisito 3: Instalación con inyección de file: dependencies

**User Story:** Como desarrollador de una aplicación que consume paquetes del store, quiero que `devlink install --dev --npm` inyecte los paquetes como `file:` dependencies apuntando al staging y ejecute `npm install`, para que npm resuelva tanto los paquetes locales como sus dependencias transitivas del registry real.

#### Criterios de Aceptación

1. WHEN el DevLink_CLI ejecuta la fase de npm install, THE DevLink_CLI SHALL hacer backup del `package.json` del proyecto antes de cualquier modificación
2. WHEN el DevLink_CLI inyecta paquetes del staging, THE DevLink_CLI SHALL agregar cada paquete como una dependencia con path relativo File_Protocol al directorio del paquete en `.devlink/` (ej: `"file:.devlink/@scope/pkg/1.0.0"`)
3. WHEN el DevLink_CLI ejecuta `npm install`, THE DevLink_CLI SHALL ejecutar una sola invocación de `npm install --no-audit --legacy-peer-deps`
4. WHEN `npm install` finaliza (exitosamente o con error), THE DevLink_CLI SHALL restaurar el `package.json` del proyecto a su contenido original exacto
5. WHEN la instalación completa exitosamente, THE DevLink_CLI SHALL actualizar el Lockfile y el Installations_Registry con los paquetes instalados

### Requisito 4: Restauración garantizada del package.json del proyecto

**User Story:** Como desarrollador, quiero que el `package.json` de mi proyecto siempre se restaure después de la instalación, para que mi repositorio no quede con dependencias `file:` temporales.

#### Criterios de Aceptación

1. THE DevLink_CLI SHALL restaurar el `package.json` del proyecto en un bloque `finally`, garantizando la restauración incluso si ocurre un error durante `npm install`
2. WHEN el `package.json` es restaurado, THE DevLink_CLI SHALL escribir el contenido byte-por-byte idéntico al backup original
3. IF el proceso recibe señales SIGINT o SIGTERM durante la instalación, THEN THE DevLink_CLI SHALL restaurar el `package.json` antes de terminar

### Requisito 5: Eliminación del manager proxy

**User Story:** Como mantenedor de DevLink, quiero eliminar completamente el manager `proxy` y todo su código asociado, para simplificar la base de código y reducir la superficie de mantenimiento.

#### Criterios de Aceptación

1. THE DevLink_CLI SHALL eliminar los archivos del directorio `src/proxy/` incluyendo `server.ts`, `npm-delegate.ts`, `tarball.ts`, `lifecycle.ts`, `project-lock.ts` y `npmrc.ts`
2. THE DevLink_CLI SHALL eliminar el archivo de tests `src/__tests__/proxy.spec.ts`
3. WHEN se define el tipo `ModeConfig.manager`, THE DevLink_CLI SHALL aceptar únicamente los valores `"store"` y `"npm"`, excluyendo `"proxy"`
4. THE DevLink_CLI SHALL eliminar la función `installViaProxy` y todo código que referencie al manager `proxy` en el comando `install`
5. THE DevLink_CLI SHALL eliminar la opción `peerOptional` del tipo `ModeConfig`, ya que el protocolo File_Protocol resuelve dependencias transitivas correctamente

### Requisito 6: Resolución semver en el staging

**User Story:** Como desarrollador, quiero que el re-link use resolución semver estándar para encontrar la mejor versión disponible de una dependencia en el staging, para que las dependencias se resuelvan de forma predecible y compatible con el ecosistema npm.

#### Criterios de Aceptación

1. WHEN el re-link busca una versión que satisfaga un Semver_Range, THE DevLink_CLI SHALL usar `semver.maxSatisfying()` para seleccionar la versión más alta que satisface el rango entre todas las versiones disponibles en el staging
2. WHEN múltiples versiones de un paquete existen en el staging, THE DevLink_CLI SHALL seleccionar la versión más alta que satisface el Semver_Range original de la dependencia
3. WHEN ninguna versión disponible satisface el Semver_Range, THE DevLink_CLI SHALL dejar la dependencia sin modificar

### Requisito 7: Compatibilidad con flujo store existente

**User Story:** Como desarrollador, quiero que el flujo existente de `devlink install --dev` (sin `--npm`) siga funcionando exactamente igual, para que la nueva funcionalidad sea aditiva y no rompa workflows existentes.

#### Criterios de Aceptación

1. WHEN el DevLink_CLI ejecuta `install` con manager `store` sin flag `--npm`, THE DevLink_CLI SHALL copiar paquetes directamente a `node_modules` como lo hace actualmente
2. THE DevLink_CLI SHALL mantener el comportamiento actual del flag `--npm` cuando se usa con manager `store` sin la nueva funcionalidad de staging (ejecutar npm install después de copiar a node_modules)
3. WHEN el flag `--npm` se usa con manager `store`, THE DevLink_CLI SHALL usar el nuevo flujo de staging + re-link + inyección en lugar del flujo actual

### Requisito 8: Dependencia semver

**User Story:** Como mantenedor de DevLink, quiero agregar `semver` como dependencia directa, para que el re-link pueda evaluar rangos de versiones de forma confiable.

#### Criterios de Aceptación

1. THE DevLink_CLI SHALL incluir `semver` como dependencia directa en `package.json`
2. THE DevLink_CLI SHALL usar las funciones `semver.satisfies()` y `semver.maxSatisfying()` del paquete `semver` para evaluar rangos de versiones en el re-link
