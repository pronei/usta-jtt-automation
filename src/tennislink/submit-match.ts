import {
  OfficialMatchContextSchema,
  MatchPayloadSchema,
  type ApprovedMatch,
  type OfficialMatchContext,
} from "../domain/schemas.js";
import { fingerprint } from "../domain/fingerprint.js";
import type { Store } from "../storage/database.js";
import type { TennisLinkWritePort } from "./write-port.js";
export async function submitMatch(args: {
  store: Store;
  jobId: string;
  approval: ApprovedMatch;
  originalContext: OfficialMatchContext;
  port: TennisLinkWritePort;
  enabled: boolean;
  confirmedApprovalId: string;
}) {
  const { store, jobId, port } = args;
  if (!args.enabled) throw new Error("Final submission is disabled");
  const approved = store.assertApproval(jobId, args.approval);
  if (args.confirmedApprovalId !== approved.approval_id)
    throw new Error("Explicit confirmation of this approval required");
  if (store.getJob(jobId).state !== "POPULATION_VERIFIED")
    throw new Error("Population has not been verified");
  const original = OfficialMatchContextSchema.parse(args.originalContext);
  if (fingerprint(original) !== approved.validation.context_hash)
    throw new Error("Original context hash mismatch");
  const current = OfficialMatchContextSchema.parse(
    await port.readCurrentContext(),
  );
  if (
    current.result_status !== "unreported" ||
    fingerprint({
      ...current,
      captured_at: original.captured_at,
      source_url: original.source_url,
    }) !== fingerprint(original)
  )
    throw new Error("Official context changed or result already exists");
  if (
    fingerprint(MatchPayloadSchema.parse(await port.readBack())) !==
    fingerprint(approved.validation.payload)
  )
    throw new Error("Read-back mismatch before submit");
  store.reserveSubmission(jobId, store.getJob(jobId).revision, approved);
  try {
    const receipt = await port.submit();
    if (
      receipt.match_id !== approved.validation.payload.match_id ||
      !receipt.receipt.trim()
    )
      throw new Error("Missing or mismatched official confirmation");
    store.completeSubmission(jobId, receipt.receipt, approved.approved_by);
  } catch (error) {
    if (store.getJob(jobId).state === "SUBMITTING")
      store.markSubmissionUnknown(jobId, approved.approved_by);
    throw error;
  }
}
