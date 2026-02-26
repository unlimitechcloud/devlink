# Store Structure

The DevLink store is a centralized repository for locally published packages.

## Default Location

By default, the store is located at:

- **Linux/macOS**: `~/.devlink/`
- **Windows**: `%LOCALAPPDATA%\DevLink\`

## Custom Location

You can use a custom location via:

```bash
# Command line flag
dev-link --repo /path/to/repo list

# Environment variable
export DEVLINK_REPO=/path/to/repo
dev-link list
```

This allows maintaining multiple independent stores for different projects or teams.

## Directory Structure

```
~/.devlink/                          # Store root
├── .lock                            # Lock file for write serialization
├── registry.json                    # Package index (metadata)
├── installations.json               # Consumer project tracking
└── namespaces/                      # Package storage
    ├── global/                      # Default namespace (reserved)
    │   ├── @scope/                  # Scoped packages
    │   │   └── package-name/
    │   │       ├── 1.0.0/           # Version directory
    │   │       │   ├── package.json
    │   │       │   ├── devlink.sig  # Content signature
    │   │       │   └── dist/        # Package files
    │   │       └── 2.0.0/
    │   └── simple-package/          # Non-scoped packages
    │       └── 1.0.0/
    └── feature-branch/              # Custom namespace
        └── @scope/
            └── package-name/
                └── 1.0.0/
```

## Files

### registry.json

The registry is an index of all published packages. It contains metadata but not the actual package files.

```json
{
  "version": "1.0.0",
  "namespaces": {
    "global": {
      "created": "2026-02-12T10:00:00Z",
      "packages": {
        "@scope/package": {
          "versions": {
            "1.0.0": {
              "signature": "6761ca1fefdde1b6e9ea372e7d6931e4",
              "published": "2026-02-12T10:00:00Z",
              "files": 15
            }
          }
        }
      }
    }
  }
}
```

### installations.json

Tracks which projects have installed packages from the store. Used by the `push` command to update consumers.

```json
{
  "version": "1.0.0",
  "projects": {
    "/home/user/my-project": {
      "registered": "2026-02-12T10:00:00Z",
      "packages": {
        "@scope/package": {
          "version": "1.0.0",
          "namespace": "global",
          "signature": "6761ca1f...",
          "installedAt": "2026-02-12T10:05:00Z"
        }
      }
    }
  }
}
```

### .lock

A lock file used to serialize write operations. Contains information about the process holding the lock.

```json
{
  "pid": 12345,
  "acquired": "2026-02-12T10:00:00Z",
  "command": "devlink publish"
}
```

### devlink.sig

Each published package version contains a signature file with an MD5 hash of the package contents. Used for integrity verification.

## Package Storage

Packages are stored in a hierarchical structure:

```
namespaces/{namespace}/{package-name}/{version}/
```

For scoped packages:
```
namespaces/{namespace}/@{scope}/{package-name}/{version}/
```

Each version directory contains:
- `package.json` - Package manifest
- `devlink.sig` - Content signature
- All files specified in the package's `files` field

## Multiple Versions

Multiple versions of the same package can coexist:

```
namespaces/global/@scope/core/
├── 1.0.0/
├── 1.1.0/
└── 2.0.0/
```

## Multiple Namespaces

The same package can exist in different namespaces with different content:

```
namespaces/
├── global/
│   └── @scope/core/1.0.0/    # Stable version
└── feature-v2/
    └── @scope/core/1.0.0/    # Development version (different code)
```

## See Also

- [Namespaces](namespaces.md) - Understanding namespace isolation
- [File Locking](locking.md) - Concurrency control
- [Publish Command](../publishing/publish.md) - Publishing packages
