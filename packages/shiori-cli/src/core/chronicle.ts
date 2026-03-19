import type {
  ShioriAnnotation,
  ChronicleEntry,
  ChronicleEvent,
  ChronicleResult,
  BuildChronicleOptions,
} from './types.ts';

/**
 * Normalize a date string (YYYY-MM or YYYY-MM-DD) to YYYY-MM-DD for sorting.
 * Month-only dates get day 01 appended.
 */
function normalizeDate(date: string): string {
  // Already YYYY-MM-DD or full ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
    return date.slice(0, 10);
  }
  // YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(date)) {
    return `${date}-01`;
  }
  return date;
}

/**
 * Check if a date string represents a date in the past relative to `now`.
 */
function isExpired(dateStr: string, now: Date): boolean {
  const normalized = normalizeDate(dateStr);
  const expiresDate = new Date(normalized);
  return expiresDate.getTime() <= now.getTime();
}

/**
 * Build chronicle entries from annotations, registry, and optional ref statuses.
 * Pure function — no I/O, no side effects.
 *
 * Degradation levels (per Architect's design):
 * 1. Full: provenance + registry + refStatuses → complete timeline
 * 2. No refStatuses: provenance + registry → timeline without external status
 * 3. No provenance: registry only → expires/expired events only
 * 4. Minimal: annotations only → location inventory with no timeline events
 */
export function buildChronicle(
  options: BuildChronicleOptions,
): ChronicleResult {
  const { annotations, registry, refStatuses, now = new Date() } = options;

  // Group annotations by ref
  const byRef = new Map<string, ShioriAnnotation[]>();
  for (const annotation of annotations) {
    if (annotation.ref === '') continue; // skip drafts
    const group = byRef.get(annotation.ref);
    if (group) {
      group.push(annotation);
    } else {
      byRef.set(annotation.ref, [annotation]);
    }
  }

  let withProvenance = 0;
  let withRefStatus = 0;
  let withExpires = 0;

  const entries: ChronicleEntry[] = [];

  for (const [ref, refAnnotations] of byRef) {
    const events: ChronicleEvent[] = [];

    // Collect locations
    const locations = refAnnotations.map((a) => ({
      file: a.location.file,
      line: a.location.line,
    }));

    // --- Provenance events (introduced) ---
    // Use the earliest provenance date across all locations for this ref
    const provenanceDates: string[] = [];
    for (const a of refAnnotations) {
      if (a.provenance?.date) {
        provenanceDates.push(a.provenance.date);
      }
    }
    if (provenanceDates.length > 0) {
      withProvenance++;
      // Sort and take earliest
      provenanceDates.sort();
      const earliest = provenanceDates[0] as string;
      const earliestAnnotation = refAnnotations.find(
        (a) => a.provenance?.date === earliest,
      );
      const author = earliestAnnotation?.provenance?.author ?? 'unknown';
      events.push({
        type: 'introduced',
        date: normalizeDate(earliest),
        label: `Introduced by ${author}`,
      });
    }

    // --- Registry events (expires / expired) ---
    const registryEntry = registry[ref];
    const expiresDate =
      refAnnotations.find((a) => a.expires)?.expires ?? registryEntry?.expires;

    if (expiresDate) {
      withExpires++;
      if (isExpired(expiresDate, now)) {
        events.push({
          type: 'expired',
          date: normalizeDate(expiresDate),
          label: `Expired on ${normalizeDate(expiresDate)}`,
        });
      } else {
        events.push({
          type: 'expires',
          date: normalizeDate(expiresDate),
          label: `Scheduled to expire on ${normalizeDate(expiresDate)}`,
        });
      }
    }

    // --- RefStatus events (status-closed) ---
    const status = refStatuses?.get(ref);
    if (status) {
      withRefStatus++;
      if (status === 'closed') {
        events.push({
          type: 'status-closed',
          date: normalizeDate(now.toISOString()),
          label: 'Referenced ticket is closed',
        });
      }
    }

    // Sort events by date (oldest first), then by type for stability
    const typeOrder: Record<string, number> = {
      introduced: 0,
      expires: 1,
      expired: 1,
      'status-closed': 2,
    };
    events.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
    });

    const entry: ChronicleEntry = {
      ref,
      locations,
      events,
    };

    // Attach optional metadata from registry/refStatus
    if (status) {
      entry.currentStatus = status;
    }
    if (registryEntry?.owner) {
      entry.owner = registryEntry.owner;
    }
    if (registryEntry?.kind) {
      entry.kind = registryEntry.kind;
    }

    entries.push(entry);
  }

  // Sort entries by ref for stable output
  entries.sort((a, b) => a.ref.localeCompare(b.ref));

  return {
    entries,
    summary: {
      totalRefs: entries.length,
      withProvenance,
      withRefStatus,
      withExpires,
    },
  };
}
