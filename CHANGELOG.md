# Changelog

All notable changes to this package are documented in this file.

## [1.0.2] - 2026-05-11

### Added

- `Config.autoMemory?: 'enabled' | 'disabled'`. When `'disabled'`, `buildSdkEnv`
  sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the SDK subprocess env so the
  Claude Agent SDK's auto-memory feature does not write to
  `~/.claude/projects/<slug>/memory/`. Default `'enabled'` preserves prior
  behavior; consumers with their own memory architecture (e.g., Scribble's
  wiki + learned behaviors) should set this to `'disabled'`.
- `buildSdkEnv` now accepts an optional third `BuildSdkEnvOptions` argument.
  Existing 2-arg call sites continue to work unchanged.

## [1.0.1] - 2026-05-07

### Changed

- Document Node.js and `loadConfig()` environment requirements.
- Make local tarball install instructions independent of the package version.

## [1.0.0] - 2026-05-07

### Added

- First stable public npm release for the reusable bot toolkit core.
- Provenance-enabled trusted publishing workflow for tagged releases.

## [0.1.0] - 2026-05-07

### Added

- Initial public npm package for the reusable bot toolkit core.
- Release checks for TypeScript declarations, packed artifacts, and generated-instruction leakage.
- GitHub Actions release workflow for publishing tagged releases to npm.
