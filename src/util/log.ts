import pc from 'picocolors';
import { redactText } from './redact.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

let current: LogLevel = 'info';
let colorEnabled = true;

export function setLogLevel(level: LogLevel): void {
  current = level;
}
export function setColor(enabled: boolean): void {
  colorEnabled = enabled;
}
export function colors() {
  return colorEnabled ? pc : pc.createColors(false);
}

function emit(level: LogLevel, prefix: string, msg: string): void {
  if (ORDER[level] > ORDER[current]) return;
  process.stderr.write(`${prefix} ${redactText(msg)}\n`);
}

export const log = {
  error: (m: string) => emit('error', colors().red('error'), m),
  warn: (m: string) => emit('warn', colors().yellow('warn '), m),
  info: (m: string) => emit('info', colors().cyan('info '), m),
  debug: (m: string) => emit('debug', colors().dim('debug'), m),
};
