/**
 * Resource bounds applied to every retrieval and scan. These are deliberately
 * conservative: OmaAudit is a pre-install check, not a full repository mirror.
 */
export interface ScanLimits {
  /** Maximum number of files admitted to the scan tree. */
  maxFiles: number;
  /** Maximum total bytes admitted to the scan tree. */
  maxTotalBytes: number;
  /** Maximum size of a single file that is read as text. Larger files are listed, not read. */
  maxTextFileBytes: number;
  /** Maximum compressed tarball size accepted from the network. */
  maxArchiveBytes: number;
  /** Maximum directory depth. */
  maxDepth: number;
  /** Wall-clock budget for one network request. */
  requestTimeoutMs: number;
  /** Wall-clock budget for the whole command. */
  commandTimeoutMs: number;
}

export const DEFAULT_LIMITS: ScanLimits = {
  maxFiles: 4000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxTextFileBytes: 1024 * 1024,
  maxArchiveBytes: 96 * 1024 * 1024,
  maxDepth: 24,
  requestTimeoutMs: 30_000,
  commandTimeoutMs: 240_000,
};

export class LimitExceededError extends Error {
  constructor(
    public readonly limit: keyof ScanLimits,
    message: string,
  ) {
    super(message);
    this.name = 'LimitExceededError';
  }
}

/** Directories that are never treated as runtime source. Entry points named in a manifest override this. */
export const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  'coverage',
  '.idea',
  '.vscode',
]);
