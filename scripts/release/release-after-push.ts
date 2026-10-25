// The entry for a release whose tag is already on origin. plan-2 only stops
// and points at the manual steps in docs/releasing.md; the second half of the
// release replaces this body.
import { SECTIONS, formatStopReport } from './lib/stop-report.ts';
import type { ValidVersion } from './lib/semver.ts';
import type { Deps } from './lib/types.ts';

export type AfterPushDecision =
  // the tag is on origin at HEAD and the version is not published (row 2)
  | { readonly kind: 'after-push'; readonly version: ValidVersion }
  // the version is published and nothing new is pending (row 3)
  | { readonly kind: 'check-only'; readonly version: ValidVersion };

export async function enterAfterPush(
  deps: Deps,
  decision: AfterPushDecision,
): Promise<number> {
  const tag = `v${decision.version}`;
  if (decision.kind === 'after-push') {
    for (const line of formatStopReport({
      at: 'entry',
      row: 2,
      reason: `${tag} is on origin and not yet published. This script does not do the second half yet: continue by hand from "${SECTIONS.checksBeforeApproval}"`,
      commands: [],
      section: SECTIONS.checksBeforeApproval,
    })) {
      deps.output.emitError(line);
    }
    return 1;
  }
  for (const line of formatStopReport({
    at: 'entry',
    row: 3,
    reason: `${tag} is already published. Check it by hand with "${SECTIONS.postRelease}"`,
    commands: [],
    section: SECTIONS.postRelease,
  })) {
    deps.output.emit(line);
  }
  return 0;
}
