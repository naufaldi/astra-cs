/**
 * WORKSHOP EXERCISE — add one bilingual guardrail rule.
 * Return a refusal sentence to stop before any price read or model call.
 * Return null to leave the existing rules in charge.
 * Deleting this file means deleting the call in resolveQuestion as well.
 */

import type { ReplyLanguage } from "./language.js";

export function extraGuardrail(_normalized: string, _language: ReplyLanguage): string | null {
  return null;
}
