import {
  type ApprovedMatch,
  type OfficialMatchContext,
  OfficialMatchContextSchema,
  MatchPayloadSchema,
} from "../domain/schemas.js";
import { fingerprint } from "../domain/fingerprint.js";
import type { Store } from "../storage/database.js";
import type { TennisLinkWritePort } from "./write-port.js";
export async function populateScores(
  store: Store,
  jobId: string,
  approval: ApprovedMatch,
  port: TennisLinkWritePort,
  originalContext: OfficialMatchContext,
) {
  const approved = store.assertApproval(jobId, approval),
    job = store.getJob(jobId);
  if (job.state !== "APPROVED") throw new Error("Job must be approved");
  await assertCurrentContext(approved, port, originalContext);
  store.checkpoint(
    jobId,
    job.revision,
    "POPULATING_TENNISLINK",
    approved.approved_by,
    { approval_id: approved.approval_id },
  );
  await port.populate(approved);
  const actual = MatchPayloadSchema.parse(await port.readBack());
  if (fingerprint(actual) !== fingerprint(approved.validation.payload))
    throw new Error("Read-back differs from approved payload");
  store.checkpoint(
    jobId,
    store.getJob(jobId).revision,
    "POPULATION_VERIFIED",
    approved.approved_by,
    { approval_id: approved.approval_id, read_back: actual },
  );
}
export async function assertCurrentContext(
  approved: ApprovedMatch,
  port: TennisLinkWritePort,
  originalContext: OfficialMatchContext,
) {
  const original = OfficialMatchContextSchema.parse(originalContext);
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
}
