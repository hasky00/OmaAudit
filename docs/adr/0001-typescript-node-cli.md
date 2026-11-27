# ADR 0001: TypeScript on Node.js, single CLI, no native dependencies

Status: accepted (2026-11-27)

## Context
The brief asks for an installable, lightweight utility with a five-minute time-to-value, strict TypeScript and Node LTS. Omarchy users have Node available through `mise`; Omarchy itself ships shell, Lua and QML, so no single "native" language is a better fit.

## Decision
Strict TypeScript (ES2023, NodeNext modules), targeting Node ≥ 24. Runtime dependencies are limited to `commander`, `zod`, `web-tree-sitter` + `tree-sitter-bash` (wasm), `tar` and `picocolors`. No package with a native build step is allowed in `dependencies`; `tree-sitter-bash`'s optional node-gyp script is not needed because only its `.wasm` is used.

## Consequences
- `npm install -g omaaudit` works on any platform without compilers.
- Tests (vitest) and build (tsc) run in a few seconds.
- Shell parsing accuracy depends on the upstream bash grammar; parse errors are surfaced as coverage gaps.
