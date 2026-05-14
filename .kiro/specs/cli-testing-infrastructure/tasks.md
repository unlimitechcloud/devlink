# Tasks

## Task 1: Add --json output to publish command

- [x] 1.1 Modify `src/commands/publish.ts` to accept a `json` parameter in `handlePublish`
- [x] 1.2 Use `createOutputRouter` to route output based on `--json` flag
- [x] 1.3 Output the `PublishResult` object as JSON to stdout when `--json` is active
- [x] 1.4 Output `{ error: message }` to stdout on failure when `--json` is active
- [x] 1.5 Update `src/cli.ts` to add `.option("--json", "Output structured JSON to stdout")` to the publish command and pass `json: !!opts.json` to `handlePublish`

## Task 2: Add --json output to push command

- [x] 2.1 Read `src/commands/push.ts` to understand the current handler structure
- [x] 2.2 Modify `handlePush` to accept a `json` parameter and use `createOutputRouter`
- [x] 2.3 Output a JSON object with `published` (PublishResult) and `consumersUpdated` (string[]) when `--json` is active
- [x] 2.4 Update `src/cli.ts` to add `--json` option to the push command

## Task 3: Add --json output to list command

- [x] 3.1 Modify `src/commands/list.ts` to accept a `json` parameter in `handleList`
- [x] 3.2 When `--json` is active, read the registry and output the namespaces/packages/versions structure as JSON
- [x] 3.3 Support namespace and package filters in JSON mode (same filtering as human mode)
- [x] 3.4 Update `src/cli.ts` to add `--json` option to the list command

## Task 4: Add --json output to resolve command

- [x] 4.1 Modify `src/commands/resolve.ts` to accept a `json` parameter in `handleResolve`
- [x] 4.2 When `--json` is active, output an array of resolution results with spec, name, version, resolved, namespace, and path fields
- [x] 4.3 Update `src/cli.ts` to add `--json` option to the resolve command

## Task 5: Add --json output to consumers command

- [x] 5.1 Modify `src/commands/consumers.ts` to accept a `json` parameter in `handleConsumers`
- [x] 5.2 When `--json` is active, output the `getConsumersInfo()` result directly as JSON (already returns structured data)
- [x] 5.3 Update `src/cli.ts` to add `--json` option to the consumers command

## Task 6: Add --json output to remove command

- [x] 6.1 Read `src/commands/remove.ts` to understand the current handler structure
- [x] 6.2 Modify `handleRemove` to accept a `json` parameter and use `createOutputRouter`
- [x] 6.3 Output a JSON object with target, removed array, and remainingVersions when `--json` is active
- [x] 6.4 Update `src/cli.ts` to add `--json` option to the remove command

## Task 7: Add --json output to verify command

- [x] 7.1 Modify `src/commands/verify.ts` to accept a `json` parameter in `handleVerify`
- [x] 7.2 When `--json` is active, output a JSON object with valid (boolean), issues array, and optional fixed array
- [x] 7.3 Map the existing `VerifyResult` fields to the JSON schema (orphansInRegistry → type: "orphan-registry", etc.)
- [x] 7.4 Update `src/cli.ts` to add `--json` option to the verify command

## Task 8: Add --json output to prune command

- [x] 8.1 Modify `src/commands/prune.ts` to accept a `json` parameter in `handlePrune`
- [x] 8.2 When `--json` is active, output a JSON object with pruned array (including path field) and dryRun boolean
- [x] 8.3 Update `src/cli.ts` to add `--json` option to the prune command

## Task 9: Create fixture utilities

- [x] 9.1 Create `src/__tests__/helpers/fixtures.ts` with `decompressPublisher`, `decompressConsumer`, `createTempStore`, and `cleanupTemp` functions
- [x] 9.2 Create `src/__tests__/helpers/cli.ts` with the `execCli` function that spawns `node dist/cli.js` as a subprocess
- [x] 9.3 Verify the helpers compile correctly by running `npm run build`

## Task 10: Create publisher fixtures

- [x] 10.1 Create `fixtures/publishers/` directory
- [x] 10.2 Create `simple-lib` fixture directory with package.json (name: @test/simple-lib, version: 1.0.0) and dist/index.js + dist/index.d.ts
- [x] 10.3 Create `simple-lib-v2` fixture directory with package.json (name: @test/simple-lib, version: 2.0.0) and additional exports
- [x] 10.4 Create `lib-with-deps` fixture directory with package.json that has dependencies on @test/simple-lib
- [x] 10.5 Create `lib-with-bin` fixture directory with package.json containing bin entries
- [x] 10.6 Create `synthetic-pkg` fixture directory with package.json containing peerDependencies
- [x] 10.7 Compress each fixture directory to .tar.gz and remove the uncompressed directories

## Task 11: Create consumer fixtures

- [x] 11.1 Create `fixtures/consumers/` directory
- [x] 11.2 Create `consumer-modes` fixture with devlink.config.mjs using modes object (modes.default: "dev", dev mode with manager: "store"), package.json with workspaces, and packages referencing @test/simple-lib
- [x] 11.3 Create `consumer-legacy` fixture with devlink.config.mjs using legacy format (direct packages, no modes object)
- [x] 11.4 Create `consumer-synthetic` fixture with devlink.config.mjs that includes a package with synthetic: true
- [x] 11.5 Compress each fixture directory to .tar.gz and remove the uncompressed directories

## Task 12: Create CLI publishing test suite

- [x] 12.1 Create `src/__tests__/cli-publish.spec.ts`
- [x] 12.2 Write test: publish a simple-lib fixture → verify exitCode 0 and JSON output contains name, version, namespace, signature, files
- [x] 12.3 Write test: publish to custom namespace → verify namespace in JSON output and list --json shows it in correct namespace
- [x] 12.4 Write test: publish same package twice → verify signature changes between publishes
- [x] 12.5 Write test: push a package → verify consumers --json shows updated consumer (requires pre-registering a consumer via install)
- [x] 12.6 Run the test suite and verify all tests pass

## Task 13: Create CLI maintenance test suite

- [x] 13.1 Create `src/__tests__/cli-maintenance.spec.ts`
- [x] 13.2 Write test: publish then remove → verify list --json no longer shows the package
- [x] 13.3 Write test: create orphan on disk (publish, then manually delete registry entry) → verify --json detects it
- [x] 13.4 Write test: prune --dry-run --json → verify output lists orphans but files still exist
- [x] 13.5 Write test: prune --json → verify orphans are removed and list confirms
- [x] 13.6 Run the test suite and verify all tests pass

## Task 14: Create CLI resolution test suite

- [x] 14.1 Create `src/__tests__/cli-resolution.spec.ts`
- [x] 14.2 Write test: publish to two namespaces → resolve with precedence → verify correct namespace selected
- [x] 14.3 Write test: resolve a package not in store → verify resolved: false in JSON output
- [x] 14.4 Write test: consumers --json after install → verify consumer tracking
- [x] 14.5 Run the test suite and verify all tests pass

## Task 15: Create CLI installation test suite

- [x] 15.1 Create `src/__tests__/cli-install.spec.ts`
- [x] 15.2 Write test: publish fixtures then install with consumer-modes fixture using --mode dev --json → verify plan output has store packages
- [x] 15.3 Write test: install with consumer-modes fixture without --mode flag → verify modes.default is resolved
- [x] 15.4 Write test: install with consumer-legacy fixture → verify backward compatibility
- [x] 15.5 Write test: install with consumer-synthetic fixture → verify synthetic packages are staged but not in package.json injected list
- [x] 15.6 Run the test suite and verify all tests pass

## Task 16: Create steering file

- [x] 16.1 Create `.kiro/steering/cli-fixtures.md` documenting: fixture categories (publisher/consumer), naming conventions, directory structure
- [x] 16.2 Document how to create new fixtures: create directory → add files → compress to tar.gz
- [x] 16.3 Document the CLI test utility API: execCli signature, CliResult interface, CliOptions interface
- [x] 16.4 Document complete test scenario examples showing fixture setup, command execution, and assertion patterns
- [x] 16.5 Document how to update existing fixtures: decompress → modify → recompress

## Task 17: Final verification

- [x] 17.1 Run `npm run build` to ensure all TypeScript compiles
- [x] 17.2 Run `npm test` to verify all existing tests still pass (no regressions)
- [x] 17.3 Run the new CLI test suites specifically and verify they all pass
- [x] 17.4 Verify that running a command without --json produces unchanged output (backward compatibility)
