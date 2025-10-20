import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import loveWordsData from "@/data/love_words_v2.json";
import { LOVE_AXES } from "@/lib/constants";
import { chat, embed } from "@/lib/llm";
import { buildAnalyzerPrompt, buildMatcherPrompt } from "@/lib/prompts";
import { qaToEmbeddingText, type QAItem } from "@/lib/qa";
import { cosineSim } from "@/lib/vectors";
import type { LoveWord } from "@/types/love-word";

const answerSchema = z
  .object({
    id: z.number(),
    type: z.enum(["open", "yesno", "yesno+open", "choice"]),
    text: z.string().min(1),
    answer: z.string()
  })
  .superRefine((value, ctx) => {
    const trimmed = value.answer.trim();
    if (!trimmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message: "answer_required"
      });
      return;
    }
    if (value.type === "yesno") {
      if (trimmed !== "はい" && trimmed !== "いいえ") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: "invalid_yesno"
        });
      }
    }
    if (value.type === "yesno+open") {
      const [choicePart] = trimmed.split("/");
      const normalizedChoice = choicePart.trim();
      if (normalizedChoice !== "はい" && normalizedChoice !== "いいえ") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: "invalid_yesno"
        });
      }
    }
  })
  .transform((value) => {
    const trimmed = value.answer.trim();
    if (value.type === "yesno") {
      return { ...value, answer: trimmed };
    }
    if (value.type === "yesno+open") {
      const [choicePart, ...rest] = trimmed.split("/");
      const choice = choicePart.trim();
      const note = rest.join("/").trim();
      const normalized = note ? `${choice} / ${note}` : choice;
      return { ...value, answer: normalized };
    }
    return { ...value, answer: trimmed };
  });

const requestSchema = z.object({
  answers: z.array(answerSchema).min(1)
});

const analyzerSchema = z.object({
  summary_ja: z.string().min(1),
  scores: z.record(z.number()).default({})
});

const matcherPickSchema = z.object({
  id: z.string(),
  term: z.string(),
  lang: z.string(),
  gloss: z.string().default(""),
  reason_ja: z.string().min(1),
  catch_ja: z.string().min(1)
});

const matcherSchema = z.object({
  picks: z.array(matcherPickSchema).min(1).max(3)
});

const words: LoveWord[] = loveWordsData as LoveWord[];
const DEBUG_LOG_ANSWERS = process.env.DEBUG_LOG_ANSWERS === "true";

function clampScore(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(3));
}

export async function POST(request: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issueMessage =
        parsed.error.issues.find(
          (issue) => typeof issue.message === "string" && issue.message.length > 0
        )?.message ?? "invalid_request";
      return NextResponse.json(
        { error: issueMessage, details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const answers = [...parsed.data.answers].sort((a, b) => a.id - b.id) as QAItem[];
    const seenIds = new Set<number>();
    for (const item of answers) {
      if (seenIds.has(item.id)) {
        return NextResponse.json({ error: "duplicate_question" }, { status: 400 });
      }
      seenIds.add(item.id);
    }

    if (DEBUG_LOG_ANSWERS) {
      console.log("[diagnose] answers", JSON.stringify(answers));
    }

    const analyzerMessages = buildAnalyzerPrompt({
      qa: answers,
      axes: LOVE_AXES
    });
    const analysisRaw = await chat(analyzerMessages);
    const analysisParsed = analyzerSchema.safeParse(JSON.parse(analysisRaw));
    if (!analysisParsed.success) {
      return NextResponse.json({ error: "analyzer_parse_failed" }, { status: 500 });
    }
    const { summary_ja, scores: rawScores } = analysisParsed.data;

    const normalizedScores: Record<string, number> = {};
    for (const axis of LOVE_AXES) {
      normalizedScores[axis] = clampScore(rawScores[axis]);
    }

    const queryVector = await embed(qaToEmbeddingText(answers));

    const ranked = await Promise.all(
      words.map(async (word) => {
        const reference = `${word.term}\n${word.gloss}\n${(word.tags || []).join(", ")}\n${
          word.culture_note || ""
        }`;
        const vector = await embed(reference);
        return { word, sim: cosineSim(queryVector, vector) };
      })
    );

    const rankedBySim = ranked.sort((a, b) => b.sim - a.sim);
    const nonJapanese = rankedBySim.filter(({ word }) => word.lang !== "ja");
    const japanese = rankedBySim.filter(({ word }) => word.lang === "ja");
    const prioritized = [...nonJapanese, ...japanese];
    const topCandidates = prioritized.slice(0, 12).map(({ word }) => word);

    const matcherMessages = buildMatcherPrompt({
      summaryJa: summary_ja,
      scores: normalizedScores,
      candidates: topCandidates,
      qa: answers
    });
    const matchRaw = await chat(matcherMessages);
    const matchParsed = matcherSchema.safeParse(JSON.parse(matchRaw));
    if (!matchParsed.success) {
      return NextResponse.json({ error: "matcher_parse_failed" }, { status: 500 });
    }

    const picks = matchParsed.data.picks.map((pick) => {
      if (!pick.gloss) {
        const fallback = words.find((word) => word.id === pick.id);
        if (fallback) {
          return { ...pick, gloss: fallback.gloss };
        }
      }
      return pick;
    });

    return NextResponse.json({
      analysis: { summary_ja, scores: normalizedScores },
      result: { picks }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
