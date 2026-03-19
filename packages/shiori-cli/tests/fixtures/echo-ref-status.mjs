#!/usr/bin/env node
// Test fixture: reads refs from stdin, outputs JSONL with all refs as 'open'
// except any ref containing 'CLOSED' which is marked 'closed'.
let data = '';
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  const refs = data.trim().split('\n').filter(Boolean);
  for (const ref of refs) {
    const status = ref.includes('CLOSED') ? 'closed' : 'open';
    process.stdout.write(JSON.stringify({ ref, status }) + '\n');
  }
});
