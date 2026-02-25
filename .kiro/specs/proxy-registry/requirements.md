# Requisitos: Proxy Registry para DevLink

## Contexto

Actualmente DevLink usa `manager: "store"` que copia paquetes directamente a `node_modules/`. Esto no resuelve dependencias transitivas de los paquetes del store. El workaround `peerOptional` funciona pero es frágil y no escala.

Se necesita un nuevo manager `"proxy"` que levante un servidor HTTP local que actúe como registry npm. Cuando `npm install` corre, todo pasa por el proxy: los paquetes del store se sirven localmente, y el resto se delega al `npm` CLI del usuario (preservando su `.npmrc`, tokens, registries privados, etc.).

## Requisitos Funcionales

### REQ-1: Nuevo manager "proxy" en ModeConfig
- Agregar `"proxy"` como opción válida en `ModeConfig.manager`
- La interfaz pública (CLI, config) no cambia — solo se agrega la nueva opción
- `"store"` y `"npm"` siguen funcionando exactamente igual

### REQ-2: Servidor proxy HTTP local
- Sirve metadata y tarballs de paquetes del store DevLink
- Delega paquetes no-locales al `npm` CLI con `--userconfig ~/.npmrc` (preserva config del usuario)
- Endpoint de health check (`/__devlink__/health`) para verificar que es el proxy correcto
- Responde al protocolo npm registry (metadata JSON + tarballs `.tgz`)

### REQ-3: Ciclo de vida del proxy (efímero)
- Al ejecutar `devlink install` con `manager: "proxy"`:
  1. Adquirir lock del proyecto (`.devlink.pid` en el directorio del proyecto)
  2. Encontrar puerto aleatorio disponible
  3. Levantar proxy como proceso hijo en background
  4. Generar `.npmrc` en el proyecto con `registry=http://localhost:{port}`
  5. Ejecutar `npm install` — npm resuelve TODO a través del proxy (store + transitivas + normales)
  6. Matar el proxy
  7. Restaurar `.npmrc` original (o eliminarlo si no existía)
  8. Liberar lock del proyecto
  9. Cleanup de archivos temporales
- El flag `--npm` no tiene efecto con `manager: "proxy"` — el `npm install` es inherente al flujo
- `peerOptional` no es necesario — npm resuelve transitivas correctamente via el proxy

### REQ-4: Lock de proyecto (prevenir ejecuciones concurrentes)
- Archivo `.devlink.pid` en el directorio del proyecto
- Contiene PID del proceso DevLink y puerto del proxy
- Detección de locks stale: si el PID ya no está vivo, el lock se puede re-adquirir
- Dos `devlink install` no pueden correr simultáneamente en el mismo proyecto

### REQ-5: Generación de tarballs desde el store
- Los paquetes del store se empaquetan como `.tgz` para servirlos via HTTP
- Se usa una carpeta temporal para los tarballs generados
- La carpeta temporal se limpia al finalizar la ejecución

### REQ-6: Delegación al npm CLI para paquetes externos
- Para paquetes no presentes en el store, ejecutar `npm view` y `npm pack` con `--userconfig ~/.npmrc`
- Esto preserva tokens, registries privados, scopes configurados del usuario
- Cache en memoria para evitar llamadas repetidas durante la misma ejecución

### REQ-7: Cleanup robusto
- Signal handlers para SIGINT y SIGTERM
- En caso de terminación abrupta: matar proxy, restaurar `.npmrc`, liberar lock, limpiar temporales
- El cleanup debe ser idempotente (puede ejecutarse múltiples veces sin error)

### REQ-8: Carpeta temporal en el store
- `{storePath}/tmp/{random-id}/` para archivos de trabajo del proxy
- Se crea al inicio y se elimina al final
- Cada instancia del proxy tiene su propia subcarpeta

## Requisitos No Funcionales

### REQ-NF-1: Transparencia
- Para el usuario, `devlink install --dev --npm` debe funcionar igual que antes
- La única diferencia es que las transitivas se resuelven correctamente

### REQ-NF-2: Sin dependencias nuevas
- El proxy usa solo módulos nativos de Node.js (`http`, `child_process`, `crypto`, `fs`, `os`, `net`)
- No se agregan dependencias externas al proyecto

### REQ-NF-3: Compatibilidad
- Node.js >= 18 (ya es requisito del proyecto)
- Linux, macOS, Windows (mismas plataformas que DevLink soporta)
