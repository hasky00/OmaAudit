import path from 'node:path';
import type { SourceFile } from '../retrieval/tree.js';

export type FileType =
  | 'shell'
  | 'pkgbuild'
  | 'pkgbuild-install'
  | 'systemd-unit'
  | 'desktop-entry'
  | 'hyprland-conf'
  | 'omarchy-manifest'
  | 'qml'
  | 'package-json'
  | 'cargo-toml'
  | 'cargo-lock'
  | 'go-mod'
  | 'python-requirements'
  | 'pyproject'
  | 'github-workflow'
  | 'makefile'
  | 'sudoers'
  | 'pacman-hook'
  | 'dockerfile'
  | 'markdown'
  | 'lua'
  | 'python'
  | 'javascript'
  | 'other-text'
  | 'binary'
  | 'skipped';

const SHELL_EXT = new Set(['.sh', '.bash', '.zsh', '.ksh', '.dash']);
const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:ba|z|k|da)?sh\b/;

export function classify(file: SourceFile): FileType {
  if (file.skipped) return file.skipReason === 'binary' ? 'binary' : 'skipped';
  const base = path.posix.basename(file.path);
  const lower = base.toLowerCase();
  const ext = path.posix.extname(lower);
  const dir = path.posix.dirname(file.path);
  const text = file.text ?? '';
  const firstLine = text.slice(0, 200).split('\n')[0] ?? '';

  if (base === 'PKGBUILD') return 'pkgbuild';
  if (ext === '.install' && /\b(?:post|pre)_(?:install|upgrade|remove)\s*\(\)/.test(text)) return 'pkgbuild-install';
  if (base === 'manifest.json' && /"schemaVersion"\s*:/.test(text) && /"kinds"\s*:/.test(text)) return 'omarchy-manifest';
  if (ext === '.qml') return 'qml';
  if (base === 'package.json') return 'package-json';
  if (base === 'Cargo.toml') return 'cargo-toml';
  if (base === 'Cargo.lock') return 'cargo-lock';
  if (base === 'go.mod') return 'go-mod';
  if (base === 'pyproject.toml') return 'pyproject';
  if (/^requirements[\w.-]*\.txt$/.test(lower)) return 'python-requirements';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file.path)) return 'github-workflow';
  if (lower === 'makefile' || lower === 'gnumakefile' || ext === '.mk') return 'makefile';
  if (ext === '.hook' && /\[Trigger\]/.test(text) && /\[Action\]/.test(text)) return 'pacman-hook';
  if (/^(?:\.?sudoers)/.test(lower) || /\/sudoers(?:\.d)?\//.test(file.path)) return 'sudoers';
  if (/^dockerfile(?:\..*)?$/.test(lower) || ext === '.dockerfile') return 'dockerfile';
  if (['.service', '.timer', '.socket', '.path', '.target', '.mount'].includes(ext) && /^\[(?:Unit|Service|Timer|Install|Socket)\]/m.test(text)) return 'systemd-unit';
  if (ext === '.desktop' && /^\[Desktop Entry\]/m.test(text)) return 'desktop-entry';
  if (ext === '.conf' && (/\bhypr/i.test(dir) || /^\s*(?:exec-once|exec|bind[a-z]*|windowrule|monitor|\$\w+)\s*=/m.test(text)) && /^\s*(?:exec-once|exec|bind[a-z]*)\s*=/m.test(text)) return 'hyprland-conf';
  if (ext === '.md' || ext === '.markdown' || lower === 'readme') return 'markdown';
  if (ext === '.lua') return 'lua';
  if (ext === '.py') return 'python';
  if (['.js', '.mjs', '.cjs', '.ts', '.mts'].includes(ext)) return 'javascript';
  if (SHELL_EXT.has(ext)) return 'shell';
  if (SHELL_SHEBANG.test(firstLine)) return 'shell';
  if (!ext && file.executable && /^#!/.test(firstLine) && /\b(?:sh|bash|zsh)\b/.test(firstLine)) return 'shell';
  if (!ext && /^(?:install|installer|setup|uninstall|bootstrap|boot|run)$/.test(lower) && /\b(?:set -e|sudo|pacman|curl|wget|echo)\b/.test(text)) return 'shell';
  return 'other-text';
}

/** Paths whose names suggest installation behaviour, used to prioritise and to never exclude. */
export function isSetupNamed(p: string): boolean {
  return /(?:^|\/)(?:[\w.-]*(?:install|installer|setup|uninstall|bootstrap|provision)[\w.-]*)$/i.test(p);
}
