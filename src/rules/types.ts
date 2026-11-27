import type { Capability, Confidence, Severity, FindingKind } from '../report/schema.js';
import type { FileType } from '../parsers/fileTypes.js';
import type { SourceFile } from '../retrieval/tree.js';
import type { ShellUnit } from '../parsers/shell.js';

export interface ClassifiedFile {
  file: SourceFile;
  type: FileType;
  text: string;
}

export interface RuleContext {
  files: ClassifiedFile[];
  /** Every shell command found in scripts and in embedded snippets, with provenance. */
  shellUnits: ShellUnit[];
  /** Paths that the Omarchy plugin manifest declares as entry points. */
  manifestEntryPoints: string[];
  /** Repository root on disk (read-only). */
  root: string;
  /** owner/repo of the repository under inspection, when known. */
  targetName?: string | undefined;
  /** Scripts that were read on demand because another script invokes them (e.g. inside build/ or vendor/). */
  invokedScripts: { path: string; invokedBy: string }[];
  /** Scripts that another script sources (`source x` / `. x`); they inherit the caller's shell options. */
  sourcedScripts: Set<string>;
  /**
   * Files that run on a user's machine even though their path looks like test or CI code: manifest entry
   * points, and anything invoked or sourced (transitively) by a non-test script or by documentation.
   * Findings in these files are never downgraded by scope.
   */
  runtimeReachable: Set<string>;
  /**
   * The source tree is incomplete: the directory walk or the archive extraction hit a resource limit. A file that is
   * not listed may still exist, so rules must not report it as missing.
   */
  truncated: boolean;
}

export interface FindingDraft {
  message: string;
  evidence: string;
  path?: string | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  severity?: Severity | undefined;
  confidence?: Confidence | undefined;
  kind?: FindingKind | undefined;
  capabilities?: Capability[] | undefined;
  remediation?: string | undefined;
  externalId?: string | undefined;
  references?: string[] | undefined;
}

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  kind: FindingKind;
  capabilities: Capability[];
  description: string;
  remediation: string;
  references?: string[];
  evaluate(ctx: RuleContext): FindingDraft[];
}
