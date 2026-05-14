# Requirements Document

## Introduction

This feature establishes a comprehensive CLI testing infrastructure for DevLink. It adds structured JSON output (`--json`) to all pre-existing commands that lack it, creates fixture-based integration tests that execute the compiled CLI binary as a subprocess, and documents the fixture strategy in a steering file. The goal is to enable reliable, fast, assertion-rich CLI tests that validate DevLink's behavior end-to-end without mocking internal modules.

## Glossary

- **CLI_Binary**: The compiled DevLink CLI entry point at `dist/cli.js`, executed via `node dist/cli.js`
- **Store**: The DevLink package repository, normally at `~/.devlink/`, redirectable via `--repo <path>`
- **Fixture**: A pre-built directory structure representing either a publishable package or a consumer project, compressed as a `.tar.gz` archive for storage and decompressed to a temp directory for each test run
- **Publisher_Fixture**: A fixture representing an npm package that gets published TO the store (simulates SDK libraries)
- **Consumer_Fixture**: A fixture representing a project that installs FROM the store (simulates monorepo consumers like Showcase)
- **Output_Router**: The existing mechanism that routes structured JSON to stdout and human messages to stderr when `--json` is active
- **Pre_Existing_Commands**: The commands that predate the pipeline refactor and lack `--json` support: publish, push, list, resolve, consumers, remove, verify, prune
- **Pipeline_Commands**: Commands that already support `--json`: plan, stage, inject, npm-install, link, hydrate, apply, install
- **Temp_Store**: A temporary directory created per test suite that serves as the `--repo` target, isolating test state from the real store
- **Steering_File**: A markdown document in `.kiro/steering/` that provides guidance to AI agents on how to work with the fixture system

## Requirements

### Requirement 1: JSON Output for Publish Command

**User Story:** As a test author, I want the publish command to output structured JSON, so that I can programmatically verify publish results in CLI tests.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object to stdout containing the fields: name, version, namespace, signature, path, and files
2. WHEN the `--json` flag is provided, THE CLI_Binary SHALL suppress all human-readable progress messages from stdout
3. WHEN the `--json` flag is NOT provided, THE CLI_Binary SHALL produce the existing human-readable output unchanged
4. IF a publish operation fails with `--json` active, THEN THE CLI_Binary SHALL output a JSON object with an error field to stderr and exit with a non-zero code

### Requirement 2: JSON Output for Push Command

**User Story:** As a test author, I want the push command to output structured JSON, so that I can verify push results including consumer updates.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object to stdout containing: publishResult (name, version, namespace, signature) and consumersUpdated (array of project paths that were updated)
2. WHEN the `--json` flag is provided, THE CLI_Binary SHALL suppress all human-readable progress messages from stdout
3. IF a push operation fails with `--json` active, THEN THE CLI_Binary SHALL output a JSON object with an error field to stderr and exit with a non-zero code

### Requirement 3: JSON Output for List Command

**User Story:** As a test author, I want the list command to output structured JSON, so that I can assert on store contents after publish/remove operations.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object to stdout containing the registry data: namespaces with their packages and versions
2. WHEN the `--json` flag is provided with namespace filters, THE CLI_Binary SHALL output only the filtered namespaces in the JSON response
3. WHEN the `--json` flag is provided with package filters, THE CLI_Binary SHALL output only the filtered packages grouped across namespaces
4. WHEN the store is empty and `--json` is provided, THE CLI_Binary SHALL output a JSON object with an empty namespaces object

### Requirement 4: JSON Output for Resolve Command

**User Story:** As a test author, I want the resolve command to output structured JSON, so that I can verify namespace precedence and package resolution logic.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON array where each entry contains: spec (the input spec), resolved (boolean), namespace, version, and path
2. WHEN a package cannot be resolved and `--json` is active, THE CLI_Binary SHALL include the entry with resolved set to false and path set to null
3. WHEN multiple namespace precedence is specified with `--json`, THE CLI_Binary SHALL include the resolvedFrom namespace in each entry

### Requirement 5: JSON Output for Consumers Command

**User Story:** As a test author, I want the consumers command to output structured JSON, so that I can verify consumer tracking after push operations.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object containing an array of consumer entries, each with: projectPath, packages (array of consumed package names), and lastUpdated timestamp
2. WHEN the `--json` flag is provided with `--package` filter, THE CLI_Binary SHALL output only consumers of the specified package
3. WHEN the `--json` flag is provided with `--prune`, THE CLI_Binary SHALL output the pruned entries in a separate removed array

### Requirement 6: JSON Output for Remove Command

**User Story:** As a test author, I want the remove command to output structured JSON, so that I can verify removal operations in tests.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object containing: target (what was requested to remove), removed (array of items actually removed with name, version, namespace), and remainingVersions (count of versions still in store for the package)
2. IF the target does not exist and `--json` is active, THEN THE CLI_Binary SHALL output a JSON object with removed as an empty array and an error field describing what was not found

### Requirement 7: JSON Output for Verify Command

**User Story:** As a test author, I want the verify command to output structured JSON, so that I can detect and assert on store integrity issues.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object containing: valid (boolean), issues (array of issue objects with type, description, namespace, package, version), and fixed (array of issues that were auto-fixed, present only when `--fix` is used)
2. WHEN the store has no integrity issues and `--json` is active, THE CLI_Binary SHALL output a JSON object with valid set to true and issues as an empty array

### Requirement 8: JSON Output for Prune Command

**User Story:** As a test author, I want the prune command to output structured JSON, so that I can verify orphan detection and removal.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided, THE CLI_Binary SHALL output a JSON object containing: pruned (array of removed orphan entries with namespace, name, version, path) and dryRun (boolean indicating whether removal was simulated)
2. WHEN `--dry-run` and `--json` are both provided, THE CLI_Binary SHALL output the same structure with dryRun set to true and no files removed from disk
3. WHEN no orphans exist and `--json` is active, THE CLI_Binary SHALL output a JSON object with pruned as an empty array

### Requirement 9: Publisher Fixture Archives

**User Story:** As a test author, I want pre-built publisher fixtures as tar.gz archives, so that tests can decompress realistic package structures to temp directories without depending on external state.

#### Acceptance Criteria

1. THE Fixture system SHALL provide publisher fixtures representing: a simple library (single package, no dependencies), a library with internal dependencies (depends on another store package), a library with bin entries, and a synthetic package (marked synthetic: true in consumer config)
2. THE Fixture system SHALL store publisher fixtures as `.tar.gz` archives in a `fixtures/publishers/` directory
3. WHEN a test decompresses a publisher fixture, THE Fixture system SHALL produce a directory with a valid package.json containing name, version, main, types, and files fields, plus a dist/ directory with at least one JavaScript file

### Requirement 10: Consumer Fixture Archives

**User Story:** As a test author, I want pre-built consumer fixtures as tar.gz archives, so that tests can decompress realistic project structures that exercise different DevLink configuration patterns.

#### Acceptance Criteria

1. THE Fixture system SHALL provide consumer fixtures representing: a monorepo with modes object configuration (like Showcase), a monorepo with legacy configuration (no modes object, direct packages), and a project with multiple workspaces
2. THE Fixture system SHALL store consumer fixtures as `.tar.gz` archives in a `fixtures/consumers/` directory
3. WHEN a test decompresses a consumer fixture, THE Fixture system SHALL produce a directory with a valid webforgeai.config.mjs (or equivalent config) containing a devlink section with packages definitions
4. THE Consumer_Fixture for modes configuration SHALL include a modes.default property and at least one named mode with a manager setting

### Requirement 11: Fixture Decompression Utilities

**User Story:** As a test author, I want utility functions to decompress fixtures to temp directories and clean them up, so that each test runs in isolation without manual setup.

#### Acceptance Criteria

1. THE Fixture system SHALL provide a function that accepts a fixture archive path and returns the path to a temporary directory containing the decompressed contents
2. THE Fixture system SHALL provide a cleanup function that removes the temporary directory after test completion
3. WHEN multiple tests run concurrently, THE Fixture system SHALL create unique temporary directories for each test to prevent interference
4. THE Fixture system SHALL use the operating system's temp directory as the base for decompressed fixtures

### Requirement 12: CLI Test Execution Utilities

**User Story:** As a test author, I want utility functions to execute the CLI binary as a subprocess with proper argument handling, so that tests interact with DevLink exactly as end users do.

#### Acceptance Criteria

1. THE CLI test utility SHALL execute `node dist/cli.js` as a child process with configurable arguments
2. THE CLI test utility SHALL always include `--repo <tempStorePath>` to isolate the store per test suite
3. THE CLI test utility SHALL return an object containing: exitCode, stdout (parsed as JSON when `--json` is used), and stderr
4. THE CLI test utility SHALL support setting the working directory (cwd) for commands that operate on the current directory (publish, install)
5. IF the CLI process exits with a non-zero code, THEN THE CLI test utility SHALL still return the result object without throwing, allowing tests to assert on error conditions

### Requirement 13: CLI Integration Test Suite — Publishing

**User Story:** As a developer, I want CLI tests that verify publish and push operations end-to-end, so that I can catch regressions in the publishing workflow.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test that publishes a publisher fixture and verifies the store state via `list --json`
2. THE Test_Suite SHALL include a test that publishes the same package twice and verifies the signature changes
3. THE Test_Suite SHALL include a test that publishes to a custom namespace and verifies namespace isolation via `list --json --namespaces`
4. THE Test_Suite SHALL include a test that pushes a package and verifies consumers are updated via `consumers --json`

### Requirement 14: CLI Integration Test Suite — Installation

**User Story:** As a developer, I want CLI tests that verify the full install pipeline end-to-end, so that I can catch regressions in package resolution, staging, and injection.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test that installs with store manager mode and verifies the plan output contains store packages
2. THE Test_Suite SHALL include a test that installs with modes.default configuration and verifies mode resolution without explicit `--mode` flag
3. THE Test_Suite SHALL include a test that installs with legacy configuration (no modes object) and verifies backward compatibility
4. THE Test_Suite SHALL include a test that verifies synthetic packages are staged but not injected into package.json
5. THE Test_Suite SHALL include a test that verifies packages with internal dependencies are relinked during stage

### Requirement 15: CLI Integration Test Suite — Maintenance

**User Story:** As a developer, I want CLI tests that verify remove, verify, and prune operations, so that I can catch regressions in store maintenance workflows.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test that removes a package and verifies it no longer appears in `list --json`
2. THE Test_Suite SHALL include a test that detects orphaned packages via `verify --json`
3. THE Test_Suite SHALL include a test that prunes orphaned packages via `prune --json` and verifies they are removed
4. THE Test_Suite SHALL include a test that uses `prune --dry-run --json` and verifies no files are actually removed

### Requirement 16: CLI Integration Test Suite — Resolution

**User Story:** As a developer, I want CLI tests that verify package resolution with namespace precedence, so that I can catch regressions in the resolver.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test that resolves a package present in multiple namespaces and verifies the correct namespace is selected based on precedence order
2. THE Test_Suite SHALL include a test that resolves a package not present in the store and verifies the resolved field is false

### Requirement 17: Steering File for Fixture Strategy

**User Story:** As an AI agent working on DevLink, I want a steering file documenting the fixture strategy, so that I can create, update, and use fixtures correctly when writing new tests.

#### Acceptance Criteria

1. THE Steering_File SHALL be located at `.kiro/steering/cli-fixtures.md`
2. THE Steering_File SHALL document: the two fixture categories (publisher and consumer), how to create new fixtures, how to compress fixtures to tar.gz, how to decompress fixtures in tests, and the naming conventions
3. THE Steering_File SHALL document the CLI test utility API including how to execute commands, assert on JSON output, and manage temp stores
4. THE Steering_File SHALL include examples of complete test scenarios showing fixture setup, command execution, and assertion patterns
