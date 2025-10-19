import type { LoveAxis } from "./constants";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface AnalyzerInput {
  freeText: string;
  axes: LoveAxis[];
}

interface MatcherInput {
  summaryJa: string;
  scores: Record<string, number>;
  candidates: Array<{
    id: string;
    term: string;
    lang: string;
    gloss: string;
    culture_note?: string;
    tags?: string[];
  }>;
}

export function buildAnalyzerPrompt({ freeText, axes }: AnalyzerInput): ChatMessage[] {
  const axisInstruction = axes
    .map((axis) => `- ${axis}: 0.0〜1.0で評価`)
    .join("\n");

  const system = `あなたは文化言語学の研究員です。入力された愛に関する自由記述を要約し、指定された軸で0.0〜1.0の連続値スコアを出力してください。
出力は必ずJSONのみ: {"summary_ja":"...", "scores":{ "<axis>":0.0〜1.0 }}
スコアは0.0以上1.0以下の小数（小数第2位程度）で提供し、全軸について値を埋めてください。
要約は200字以内の自然な日本語で書いてください。`;

  const user = `入力:
${freeText}

評価軸:
${axisInstruction}`;

  return [
    {
      role: "system",
      content: system
    },
    {
      role: "user",
      content: user
    }
  ];
}

export function buildMatcherPrompt({ summaryJa, scores, candidates }: MatcherInput): ChatMessage[] {
  const system = `あなたは文化言語学の編集者です。候補語彙TopKから最適な1語のみ選び、
100〜140字の適合理由と30字以内のSNS向けキャッチを日本語で生成してください。
出力は必ずJSONのみ:
{ "pick": {"id":"...","term":"...","lang":"...","gloss":"...","reason_ja":"...","catch_ja":"..."} }
理由は敬体ではなく常体で端的にまとめ、キャッチは語を含めてもよいが30字以内で完結させます。`;

  const candidateText = candidates
    .map((c, index) => {
      const tags = c.tags?.length ? `タグ: ${c.tags.join(", ")}` : "";
      const note = c.culture_note ? `文化ノート: ${c.culture_note}` : "";
      return `#${index + 1} ${c.term} (${c.lang})
定義: ${c.gloss}
${tags}
${note}`.trim();
    })
    .join("\n\n");

  const scoreText = Object.entries(scores)
    .map(([key, value]) => `${key}: ${value.toFixed(2)}`)
    .join(", ");

  const user = `診断要約:
${summaryJa}

スコア:
${scoreText}

候補語彙:
${candidateText}

条件:
- 候補以外を選ばない
- 日本語候補は他言語よりも明確な適合理由がある場合のみ選ぶ。その際は理由にその判断根拠を書く
- glossが空なら空文字を返してよい
- reason_jaは100〜140字、catch_jaは30字以内
- JSON以外のテキストを出力しない`;

  return [
    {
      role: "system",
      content: system
    },
    {
      role: "user",
      content: user
    }
  ];
}
