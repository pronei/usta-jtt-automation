import type {
  ApprovedMatch,
  MatchPayload,
  OfficialMatchContext,
} from "../domain/schemas.js";
// Production implementation intentionally absent until authenticated selectors are verified.
// Never implement this port using AI-generated selectors or a blind final click.
export interface TennisLinkWritePort {
  readCurrentContext(): Promise<OfficialMatchContext>;
  populate(approved: ApprovedMatch): Promise<void>;
  readBack(): Promise<MatchPayload>;
  submit(): Promise<{ match_id: string; receipt: string }>;
}
