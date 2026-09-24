import { z } from "zod";
export const AcademyFilterSchema = z.strictObject({
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  team_ids: z.array(z.string().trim().min(1)).default([]),
});
export type AcademyFilter = z.infer<typeof AcademyFilterSchema>;
export interface TeamIdentity {
  team_id: string | null;
  team_name: string;
}
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function matchesAcademy(
  team: TeamIdentity,
  raw: AcademyFilter,
): boolean {
  const filter = AcademyFilterSchema.parse(raw);
  // Explicit team IDs are authoritative when configured; missing IDs never fall back to names.
  if (filter.team_ids.length)
    return team.team_id !== null && filter.team_ids.includes(team.team_id);
  const haystack = ` ${normalize(team.team_name)} `;
  return [filter.name, ...filter.aliases].some((name) => {
    const needle = normalize(name);
    return !!needle && haystack.includes(` ${needle} `);
  });
}
