/**
 * shiori Playground — Browser bundle entry point.
 *
 * Re-exports pure functions for in-browser annotation parsing,
 * scanning, and verification. No Node.js dependencies.
 */

// Parser
export { parseShioriFields } from "../core/parser.ts";
export type { ParsedShioriFields } from "../core/parser.ts";

// Comment syntax
export { getCommentSyntax, COMMENT_SYNTAXES, EXTENSION_MAP } from "../core/comment-syntax.ts";
export type { CommentSyntax } from "../core/comment-syntax.ts";

// Provider (CommentProvider for in-browser scanning)
export { CommentProvider } from "../core/providers/CommentProvider.ts";
export type { FileInput, ProviderResult } from "../core/providers/AnnotationProvider.ts";

// Verify
export { verify } from "../commands/verify.ts";
export type { VerifyOptions } from "../commands/verify.ts";

// Ref validation
export { isValidRef, REF_PATTERN } from "../core/ref-validation.ts";

// Core types
export type {
  ShioriAnnotation,
  ShioriCandidate,
  ScanResult,
  Registry,
  RegistryEntry,
  VerifyResult,
  VerifyIssue,
  VerifyIssueType,
} from "../core/types.ts";
export { VERIFY_ISSUE_TYPES } from "../core/types.ts";
