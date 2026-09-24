import { z } from "zod";
export const PipelineStateSchema = z.enum([
  "RECEIVED",
  "IMAGE_PREPARED",
  "MATCH_DISCOVERED",
  "TENNISLINK_MATCH_FOUND",
  "OFFICIAL_CONTEXT_CAPTURED",
  "SCORE_SHEET_INTERPRETED",
  "VALIDATING",
  "NEEDS_REVIEW",
  "VALIDATED",
  "APPROVED",
  "POPULATING_TENNISLINK",
  "POPULATION_VERIFIED",
  "SUBMITTING",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED",
  "FAILED",
]);
export type PipelineState = z.infer<typeof PipelineStateSchema>;
const transitions: Record<PipelineState, readonly PipelineState[]> = {
  RECEIVED: ["IMAGE_PREPARED", "FAILED"],
  IMAGE_PREPARED: ["MATCH_DISCOVERED", "NEEDS_REVIEW", "FAILED"],
  MATCH_DISCOVERED: ["TENNISLINK_MATCH_FOUND", "NEEDS_REVIEW", "FAILED"],
  TENNISLINK_MATCH_FOUND: ["OFFICIAL_CONTEXT_CAPTURED", "FAILED"],
  OFFICIAL_CONTEXT_CAPTURED: ["SCORE_SHEET_INTERPRETED", "FAILED"],
  SCORE_SHEET_INTERPRETED: ["VALIDATING", "FAILED"],
  VALIDATING: ["VALIDATED", "NEEDS_REVIEW", "FAILED"],
  NEEDS_REVIEW: ["MATCH_DISCOVERED", "VALIDATING", "FAILED"],
  VALIDATED: ["APPROVED", "NEEDS_REVIEW"],
  APPROVED: ["POPULATING_TENNISLINK", "NEEDS_REVIEW", "FAILED"],
  POPULATING_TENNISLINK: ["POPULATION_VERIFIED", "NEEDS_REVIEW", "FAILED"],
  POPULATION_VERIFIED: ["SUBMITTING", "NEEDS_REVIEW"],
  SUBMITTING: ["SUBMITTED", "SUBMISSION_UNKNOWN"],
  SUBMISSION_UNKNOWN: ["SUBMITTED"],
  SUBMITTED: [],
  FAILED: [],
};
export function assertTransition(from: PipelineState, to: PipelineState): void {
  if (!transitions[from].includes(to))
    throw new Error(`Illegal transition: ${from} -> ${to}`);
}
// FAILED jobs require a new job linked to their audit history. In-flight submissions never auto-retry.
