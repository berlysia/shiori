// The npm dist-tag for a version. release.yml decides the same thing in shell
// from the tag name; a structural test keeps the two in step.
export function distTagFor(version: string): 'latest' | 'next' {
  return version.includes('-') ? 'next' : 'latest';
}
