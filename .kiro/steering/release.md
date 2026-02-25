---
inclusion: manual
---

# Release Guide for AI Assistants

Instructions for AI assistants to manage releases of `@unlimitechcloud/devlink`.

## Prerequisites Check

Before starting a release, execute these checks:

### 1. GitHub CLI Installation

```bash
which gh
```

**If not installed:** Install it for the user:
```bash
# Ubuntu/Debian
sudo apt install gh -y

# macOS
brew install gh

# Windows (winget)
winget install GitHub.cli
```

### 2. GitHub CLI Authentication

```bash
gh auth status
```

**If authenticated:** Proceed. Shows the logged-in user and scopes.

**If not authenticated:** Execute the login flow:
```bash
gh auth login --web
```

This will:
1. Display a one-time code (e.g., `XXXX-XXXX`)
2. Open a browser URL (or display it if browser can't open)

Tell the user:
```
GitHub authentication required.

1. A browser window should open (or go to: https://github.com/login/device)
2. Enter this code: XXXX-XXXX
3. Authorize the GitHub CLI
4. Come back here once done

Waiting for authentication...
```

The command will complete automatically once the user authorizes in the browser.

### 3. Git Status

```bash
git status
```

**If clean:** Proceed.
**If dirty:** Show the user what files are modified and ask:
- Commit them first?
- Stash them?
- Abort release?

### 4. Current Branch

```bash
git branch --show-current
```

**Must be on `master`.** If not on master, abort and inform the user:
```
Release must be done from master branch.
Current branch: feature-x

To proceed, you can:
1. Switch to master: git checkout master
2. Or merge your branch into master first, then run the release from master

Release aborted.
```

Do not assist with the merge unless explicitly requested - that's a separate workflow.

### 5. Current Version

```bash
node -p "require('./package.json').version"
```

Store this for version comparison later.

## Release Process

### Step 1: Generate Changelog Entry

Analyze changes since the last release:

```bash
# Get last tag
git describe --tags --abbrev=0

# List commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

Create a new section in `CHANGELOG.md` with placeholder version:

```markdown
## [x.x.x] - YYYY-MM-DD

### Added
- New features...

### Changed
- Changes to existing functionality...

### Fixed
- Bug fixes...

### Breaking Changes
- Any breaking changes (triggers MAJOR version bump)
```

**Guidelines for changelog:**
- Focus on functional changes, not implementation details
- Group related changes together
- Use clear, user-facing language
- Mark breaking changes explicitly

### Step 1b: Confirm Changelog with User

Present the generated changelog to the user:

```
Here's the proposed changelog for this release:

---
### Added
- Feature X
- Feature Y

### Fixed
- Bug Z
---

Please review and let me know:
- Confirm as-is
- Or provide feedback/adjustments
```

**Iterate until user confirms.** The user may:
- Request rewording
- Add missing items
- Remove items
- Change categorization (Added → Changed, etc.)

Only proceed to version determination after user confirms the changelog content.

### Step 2: Determine Version Number

Based on the changelog, suggest version bump following semver:

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking changes | MAJOR | 1.0.0 → 2.0.0 |
| New features (backward compatible) | MINOR | 1.0.0 → 1.1.0 |
| Bug fixes, small changes, unclear | PATCH | 1.0.0 → 1.0.1 |

**Decision flow:**
1. If "Breaking Changes" section exists → suggest MAJOR bump
2. If "Added" section has significant new features → suggest MINOR bump
3. Otherwise (fixes, small changes, or unclear) → **default to PATCH bump**

**When in doubt, always suggest PATCH (micro version increment).**

Present suggestion to user:
```
Based on the changelog:
- Current version: 1.0.0
- Suggested next version: 1.0.1 (PATCH - bug fixes and minor changes)

Confirm version [1.0.1] or specify different version:
```

**Validation:**
- New version MUST be greater than current version
- Use semver comparison to validate

### Step 3: Update Files

Once version is confirmed:

1. **Update CHANGELOG.md** - Replace `[x.x.x]` with actual version and date:
```markdown
## [1.1.0] - 2025-02-12
```

2. **Update package.json** - Set the new version:
```bash
npm version 1.1.0 --no-git-tag-version
```

3. **Update README.md** - Replace the "### Latest" section under "## Changelog" with the new version, date, and a concise summary (max 5-6 bullet points of the most notable changes). Keep the link to `CHANGELOG.md`.

### Step 4: Commit and Push

```bash
git add CHANGELOG.md README.md package.json package-lock.json
git commit -m "chore: release v1.1.0"
git push origin master
```

### Step 5: Create GitHub Release

Extract the changelog section for this version and create release:

```bash
# Create tag and release
gh release create v1.1.0 \
  --title "v1.1.0" \
  --notes "CHANGELOG_SECTION_HERE"
```

**Note:** The `--notes` should contain only the content of the changelog section for this version (without the version header).

### Step 6: npm Publication (Optional)

Ask the user:
```
Do you want to publish this version to npm (public registry)?
This will create tag v1.1.0-npm and trigger the npm publish workflow.
[yes/no]
```

If yes:
```bash
git tag v1.1.0-npm v1.1.0
git push origin v1.1.0-npm
```

## Creating npm Tag for Existing Version

If user wants to publish an existing version to npm later:

```bash
# Verify the version tag exists
git tag -l "v1.0.0"

# Create npm tag based on existing version tag
git tag v1.0.0-npm v1.0.0
git push origin v1.0.0-npm
```

## Changelog Format

The `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.1.0] - 2025-02-12

### Added
- New `docs` command for embedded documentation access
- Support for `--repo` flag to customize store location

### Changed
- Improved error messages for resolution failures

### Fixed
- File locking race condition on Windows

## [1.0.0] - 2025-02-10

### Added
- Initial release
```

## Workflow Summary

The AI assistant executes all commands directly. User interaction is only required for:
- Confirming the version number
- Browser authentication (if not logged in)
- Confirming npm publication

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Check/install gh CLI                                      │
├─────────────────────────────────────────────────────────────┤
│ 2. Check gh auth → Run login flow if needed (user confirms   │
│    in browser)                                               │
├─────────────────────────────────────────────────────────────┤
│ 3. Check git status → Handle dirty state if needed           │
├─────────────────────────────────────────────────────────────┤
│ 4. Analyze commits → Generate changelog entry                │
├─────────────────────────────────────────────────────────────┤
│ 5. Present changelog to user → Iterate until confirmed       │
├─────────────────────────────────────────────────────────────┤
│ 6. Suggest version based on changes → User confirms          │
├─────────────────────────────────────────────────────────────┤
│ 7. Update CHANGELOG.md, README.md and package.json           │
├─────────────────────────────────────────────────────────────┤
│ 8. Commit and push                                           │
├─────────────────────────────────────────────────────────────┤
│ 9. Create GitHub Release with changelog notes                │
├─────────────────────────────────────────────────────────────┤
│ 10. Ask about npm publication → Create -npm tag if confirmed │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling

- **gh not installed:** Install it automatically using the appropriate package manager for the user's OS
- **gh not authenticated:** Execute `gh auth login --web` and guide user through the browser flow
- **Dirty working directory:** List uncommitted changes, offer to commit or stash them
- **Not on master branch:** Abort release, instruct user to switch to master
- **Version validation fails:** Explain why and ask for valid version
- **Release creation fails:** Check if tag already exists, offer to delete and recreate
- **npm tag already exists:** Offer to delete and recreate
