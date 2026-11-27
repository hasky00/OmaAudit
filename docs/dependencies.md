# Dependency inventory

Generated 2026-11-27 from `npm ls --omit=dev --all` (Node 26.8.1, npm 12.0.2). Regenerate with the same command; CI uploads `dependency-inventory.json` on every run.

## Runtime dependencies (6 direct, 13 total)

| Package | Version | Licence | Why | Native code? |
|---|---|---|---|---|
| commander | 15.1.0 | MIT | CLI parsing | no |
| picocolors | 1.1.1 | ISC | terminal colours | no |
| tar | 7.5.24 | BlueOak-1.0.0 | streaming tar.gz extraction with entry filters | no |
| ├ @isaacs/fs-minipass | 4.0.1 | ISC | tar internals | no |
| ├ chownr | 3.0.0 | BlueOak-1.0.0 | tar internals (ownership is disabled by `preserveOwner: false`) | no |
| ├ minipass | 7.1.3 | ISC | tar internals | no |
| ├ minizlib | 3.1.0 | MIT | gzip | no |
| └ yallist | 5.0.0 | BlueOak-1.0.0 | tar internals | no |
| tree-sitter-bash | 0.25.1 | MIT | bash grammar; only `tree-sitter-bash.wasm` is loaded | ships an optional node-gyp binding that is **not built or used** (`npm ci --ignore-scripts`) |
| ├ node-addon-api | 8.9.2 | MIT | pulled in by the unused native binding | no (headers only) |
| └ node-gyp-build | 4.8.4 | MIT | pulled in by the unused native binding | no |
| web-tree-sitter | 0.27.2 | MIT | tree-sitter runtime compiled to WebAssembly | WebAssembly, no native |
| zod | 4.6.7 | MIT | report schema validation | no |

`tree-sitter` (peer of `tree-sitter-bash`) is intentionally not installed. A follow-up could switch to the `tree-sitter-wasms` bundle (Unlicense) to drop the two unused native-binding helpers.

## Development dependencies

typescript 5.9, vitest 3.2, tsx 4.23, @types/node 24.

## External tools (optional, detected at run time)

ShellCheck 0.11 (GPL-3.0), OSV-Scanner 2.7 (Apache-2.0). Neither is bundled or required.

## Licence compatibility

All runtime dependencies are MIT, ISC or BlueOak-1.0.0, compatible with the proposed Apache-2.0 licence. No GPL code is linked or redistributed; ShellCheck is invoked as a separate process when the user has installed it.
