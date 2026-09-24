import { z } from "zod";
const selector = z.string().min(1);
// Must be calibrated using a permitted authenticated session; no fabricated production selectors.
export const SelectorsSchema = z.strictObject({
  entry_ready: selector,
  match_number_input: selector,
  lookup_button: selector,
  match_ready: selector,
  match_id: selector,
  date: selector.nullable(),
  result_status: selector,
  unreported_text: selector,
  reported_text: selector,
  home: z.strictObject({
    team_id: selector,
    team_name: selector,
    roster_options: selector,
  }),
  away: z.strictObject({
    team_id: selector,
    team_name: selector,
    roster_options: selector,
  }),
  line_rows: selector,
  line_position: selector,
  line_type: selector,
});
export type Selectors = z.infer<typeof SelectorsSchema>;
