# File Locking

DevLink uses file locking to serialize write operations and prevent store corruption when multiple processes access the store simultaneously.

## How It Works

When a command needs to modify the store, it:

1. Attempts to acquire an exclusive lock
2. If lock is held by another process, waits and retries
3. Executes the operation
4. Releases the lock

## Lock File

The lock is implemented as a file at `{store}/.lock`:

```json
{
  "pid": 12345,
  "acquired": "2026-02-12T10:00:00Z",
  "command": "dev-link publish"
}
```

## Operations Requiring Lock

| Command | Requires Lock | Reason |
|---------|---------------|--------|
| `publish` | ✓ | Modifies registry.json, writes files |
| `push` | ✓ | Modifies registry.json, installations.json |
| `install` | ✓ | Modifies installations.json |
| `remove` | ✓ | Modifies registry.json, deletes files |
| `verify --fix` | ✓ | Modifies registry.json |
| `prune` | ✓ | Modifies registry.json, deletes files |
| `consumers --prune` | ✓ | Modifies installations.json |
| `list` | ✗ | Read-only |
| `resolve` | ✗ | Read-only |
| `verify` | ✗ | Read-only |
| `consumers` | ✗ | Read-only |

## Lock Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Timeout | 30 seconds | Maximum wait time for lock |
| Retry interval | 100ms | Time between retry attempts |
| Stale detection | 10 seconds | Lock considered stale if process is dead |

## Stale Lock Detection

If a process crashes while holding the lock, DevLink detects this by:

1. Reading the PID from the lock file
2. Checking if that process is still running
3. If process is dead, removing the stale lock

This prevents deadlocks from crashed processes.

## Concurrent Access Example

```
Terminal A: devlink publish          Terminal B: devlink push
─────────────────────────────        ─────────────────────────

1. Acquire lock ✓                    1. Acquire lock
                                        ⏳ Store locked by PID 1234
2. Read registry.json
3. Copy files                        2. Retry (100ms)
4. Update registry.json                 ⏳ Still locked
5. Release lock ✓
                                     3. Acquire lock ✓
                                     4. Continue operation...
                                     5. Release lock ✓
```

## Troubleshooting

### Lock Timeout

If you see "Lock timeout" errors:

1. Check if another DevLink process is running
2. Check for stale lock files (process crashed)
3. Manually remove `.lock` file if necessary

```bash
# Check lock file
cat ~/.devlink/.lock

# Remove stale lock (use with caution)
rm ~/.devlink/.lock
```

### Multiple Repos

Each repo has its own lock file, so operations on different repos don't block each other:

```bash
# These can run simultaneously
devlink --repo /repo-a publish &
devlink --repo /repo-b publish &
```

## Implementation Details

The lock uses atomic file operations:

1. Create lock file with `O_EXCL` flag (fails if exists)
2. Write lock info (PID, timestamp, command)
3. On release, delete lock file

This ensures only one process can hold the lock at a time.

## See Also

- [Store Structure](structure.md) - Lock file location
- [Verify Command](../maintenance/verify.md) - Check store integrity
