import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import loveWordsData from "@/data/love_words.json";
import { DEFAULT_INPUT_LANG, LOVE_AXES, MAX_FREE_TEXT_LENGTH } from "@/lib/constants";
import { chat, embed } from "@/lib/llm";
import { buildAnalyzerPrompt, buildMatcherPrompt } from "@/lib/prompts";
import { cosineSim } from "@/lib/vectors";
import type { LoveWord } from "@/types/love-word";

const requestSchema = z.object({
  freeText: z.string(),
  lang: z.string().optional()
});

const analyzerSchema = z.object({
  summary_ja: z.string().min(1),
  scores: z.record(z.number()).default({})
});

const matcherSchema = z.object({
  pick: z.object({
    id: z.string(),
    term: z.string(),
    lang: z.string(),
    gloss: z.string().default(""),
    reason_ja: z.string().min(1),
    catch_ja: z.string().min(1)
  })
});

const words: LoveWord[] = loveWordsData as LoveWord[];

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
      return NextResponse.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const lang = parsed.data.lang || DEFAULT_INPUT_LANG;
    const clipped = parsed.data.freeText.slice(0, MAX_FREE_TEXT_LENGTH);

    if (!clipped.trim()) {
      return NextResponse.json({ error: "empty" }, { status: 400 });
    }

    const analyzerMessages = buildAnalyzerPrompt({
      freeText: clipped,
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

    const queryVector = await embed(`${clipped}\n要約: ${summary_ja}`);

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
    const topCandidates = prioritized.slice(0, 6).map(({ word }) => word);

    const matcherMessages = buildMatcherPrompt({
      summaryJa: summary_ja,
      scores: normalizedScores,
      candidates: topCandidates
    });
    const matchRaw = await chat(matcherMessages);
    const matchParsed = matcherSchema.safeParse(JSON.parse(matchRaw));
    if (!matchParsed.success) {
      return NextResponse.json({ error: "matcher_parse_failed" }, { status: 500 });
    }

    const pick = matchParsed.data.pick;
    if (!pick.gloss) {
      const fallback = words.find((word) => word.id === pick.id);
      if (fallback) {
        pick.gloss = fallback.gloss;
      }
    }

    return NextResponse.json({
      analysis: { summary_ja, scores: normalizedScores },
      result: { pick }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
