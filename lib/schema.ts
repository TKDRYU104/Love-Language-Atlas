import { z } from "zod";

export const AnalyzerSchema = z.object({
  summary_ja: z.string().min(10, "summary_ja must include a descriptive summary"),
  scores: z
    .record(z.number().min(0).max(1))
    .default({})
});

export const MatcherSchema = z.object({
  pick: z.object({
    id: z.string(),
    term: z.string(),
    lang: z.string(),
    gloss: z.string().optional(),
    reason_ja: z.string().min(30),
    catch_ja: z.string().min(4).max(60)
  })
});
