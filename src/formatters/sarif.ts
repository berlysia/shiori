import type {
  IssueSeverity,
  VerifyIssueType,
  VerifyResult,
} from '../core/types.ts';

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number };
  };
}

interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations?: SarifLocation[];
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

function mapSeverity(severity: IssueSeverity): string {
  return severity === 'error' ? 'error' : 'warning';
}

const RULE_DESCRIPTIONS: Record<VerifyIssueType, string> = {
  'missing-in-registry': 'Annotation ref found in source but not in registry',
  'unused-in-source': 'Registry entry not found in source annotations',
  expired: 'Registry entry has passed its expiration date',
  'syntax-error': 'Annotation has syntax errors',
  'ref-format': 'Annotation ref has invalid format',
  'ref-collision': 'Ref defined in multiple registry files',
  'unrouted-ref':
    'Annotation ref does not match any configured routing pattern',
  'registry-routing-mismatch':
    'Registry entry exists in a file that does not match its routing pattern',
  'expiring-soon': 'Registry entry is approaching its expiration date',
  'ref-status-closed':
    'Referenced issue/ticket reported as closed by external status command',
};

/**
 * Format VerifyResult as SARIF v2.1.0 for GitHub Code Scanning integration.
 */
export function formatAsSarif(result: VerifyResult): string {
  // Deduplicate rule IDs
  const ruleIds = [...new Set(result.issues.map((i) => i.type))];
  const rules: SarifRule[] = ruleIds.map((id) => ({
    id,
    shortDescription: {
      // Fallback to raw id for runtime safety if VerifyIssueType is extended
      // before RULE_DESCRIPTIONS is updated (should not happen with Record<VerifyIssueType, string>)
      text: RULE_DESCRIPTIONS[id] ?? id,
    },
  }));

  const results: SarifResult[] = result.issues.map((issue) => {
    const sarifResult: SarifResult = {
      ruleId: issue.type,
      level: mapSeverity(issue.severity),
      message: { text: issue.message },
    };

    if (issue.file !== undefined && issue.line !== undefined) {
      sarifResult.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri: issue.file },
            region: { startLine: issue.line },
          },
        },
      ];
    }

    return sarifResult;
  });

  const sarif: SarifLog = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'shiori',
            version: '0.1.0',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
