// The only exit for text shown to a person. Everything passes through
// sanitizeForTerminal, because most of what is printed (command output, file
// names, npm and GitHub responses) is not written by this repository.
// layers.test.ts forbids console.* and process.stdout/stderr.write elsewhere.
import { sanitizeForTerminal } from './lib/sanitize.ts';
import type { Output } from './lib/types.ts';

export interface Writers {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export function createOutput(writers: Writers): Output {
  return {
    emit: (line) => writers.stdout(`${sanitizeForTerminal(line)}\n`),
    emitError: (line) => writers.stderr(`${sanitizeForTerminal(line)}\n`),
    emitChunk: (text) => {
      const clean = sanitizeForTerminal(text);
      if (clean !== '') writers.stderr(clean);
    },
  };
}

export const processOutput: Output = createOutput({
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
