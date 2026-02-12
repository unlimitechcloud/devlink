# Publish Command

Publishes a package from the current directory to the DevLink store.

## Usage

```bash
devlink publish [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Target namespace (default: `global`) |
| `--repo <path>` | Use custom repo path |

## Description

The `publish` command:

1. Reads `package.json` from the current directory
2. Validates that `name` and `version` fields exist
3. Copies files to the store based on the `files` field
4. Generates a content signature (MD5 hash)
5. Updates the registry with package metadata

## Package Requirements

Your `package.json` must have:

```json
{
  "name": "@scope/my-package",
  "version": "1.0.0",
  "files": ["dist", "lib"]
}
```

- **name**: Package name (scoped or unscoped)
- **version**: Semantic version
- **files**: Array of files/directories to include

## Examples

### Publish to Global

```bash
cd my-package
devlink publish
```

Output:
```
📦 @scope/my-package@1.0.0 published to global
   Signature: 6761ca1fefdde1b6e9ea372e7d6931e4
   Files: 15
   Path: ~/.devlink/namespaces/global/@scope/my-package/1.0.0
```

### Publish to Custom Namespace

```bash
devlink publish -n feature-v2
```

### Publish to Custom Repo

```bash
devlink publish --repo /path/to/repo
```

### Publish Multiple Versions

```bash
# Publish v1
devlink publish

# Update version in package.json to 2.0.0
devlink publish  # Both versions coexist
```

## What Gets Published

Files are selected based on the `files` field in `package.json`:

```json
{
  "files": ["dist", "lib", "README.md"]
}
```

Always included:
- `package.json`

The following are typically excluded:
- `node_modules/`
- `.git/`
- Test files
- Source files (unless specified)

## Signature

Each published version gets a signature file (`devlink.sig`) containing an MD5 hash of the package contents. This is used for:

- Integrity verification
- Change detection
- Consumer updates (push command)

## Overwriting Versions

Publishing the same version again overwrites the existing content:

```bash
# First publish
devlink publish  # @scope/pkg@1.0.0

# Make changes, publish again
devlink publish  # Overwrites @scope/pkg@1.0.0
```

The signature will change if the content changed.

## Errors

### Missing package.json

```
Error: package.json not found
```

Ensure you're in a directory with a valid `package.json`.

### Missing name or version

```
Error: package.json must have name and version fields
```

Add the required fields to your `package.json`.

## See Also

- [Push Command](push.md) - Publish and update consumers
- [Store Structure](../store/structure.md) - Where packages are stored
- [Namespaces](../store/namespaces.md) - Understanding namespaces
