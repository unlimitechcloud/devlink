# DevLink — Development Guide

Guide for AI agents working on the DevLink codebase. For usage documentation, use `dev-link docs agents.md`.

## Project Structure

```
src/
├── cli.ts                  # CLI entry point, argument parsing
├── index.ts                # Library exports
├── config.ts               # Configuration utilities
├── installer.ts            # Installer utilities
├── store.ts                # Store path utilities
├── constants.ts            # Paths, defaults, repo configuration
├── types.ts                # TypeScript type definitions
├── core/
│   ├── lock.ts             # File locking implementation
│   ├── registry.ts         # Registry read/write operations
│   ├── installations.ts    # Consumer tracking operations
│   ├── store.ts            # Filesystem operations (copy, delete, etc.)
│   ├── resolver.ts         # Package resolution algorithm
│   └── staging.ts          # Staging + file: protocol rewriting for --npm flow
├── commands/
│   ├── index.ts            # Re-exports all command handlers
│   ├── publish.ts          # Publish command
│   ├── push.ts             # Push command
│   ├── install.ts          # Install command
│   ├── list.ts             # List command
│   ├── resolve.ts          # Resolve command
│   ├── consumers.ts        # Consumers command
│   ├── remove.ts           # Remove command
│   ├── verify.ts           # Verify command
│   ├── prune.ts            # Prune command
│   └── docs.ts             # Docs command (embedded documentation)
└── formatters/
    ├── tree.ts             # Tree output format
    └── flat.ts             # Flat output format
```

## Documentation Structure

```
docs/
├── AGENTS.md               # Root agent guide (served by `devlink docs agents.md`)
├── store/
│   ├── AGENTS.md           # Store section agent guide
│   ├── structure.md
│   ├── namespaces.md
│   └── locking.md
├── publishing/
│   ├── AGENTS.md           # Publishing section agent guide
│   ├── publish.md
│   └── push.md
├── installation/
│   ├── AGENTS.md           # Installation section agent guide
│   ├── install.md
│   └── configuration.md
├── inspection/
│   ├── AGENTS.md           # Inspection section agent guide
│   ├── list.md
│   ├── resolve.md
│   └── consumers.md
└── maintenance/
    ├── AGENTS.md           # Maintenance section agent guide
    ├── remove.md
    ├── verify.md
    └── prune.md
```

AGENTS.md files follow a specialization hierarchy:
- `docs/AGENTS.md` → Overview, all commands, core concepts, navigation
- `docs/<section>/AGENTS.md` → Section-specific context and command index

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (ESM) |
| CLI Framework | Commander.js |
| Build | tsc |
| Tests | Vitest |
| Package Manager | npm |

## Development

```bash
npm run build          # Compile TypeScript
npm test               # Run tests
npm run test:coverage  # Tests with coverage
```

Test fixtures are in `fixtures/packages/` for integration testing.

## Publishing

DevLink publishes itself via DevLink:

```bash
npm run build
dev-link push           # Publish + update all consumers
```

## Conventions

- Commands are in `src/commands/`, each exports a `handle<Command>` function
- Core logic is in `src/core/`, shared across commands
- Formatters in `src/formatters/` handle tree vs flat output
- Documentation served by `docs` command lives in `docs/`
- Root `AGENTS.md` (this file) is for development; `docs/AGENTS.md` is for usage
