import type { LoveAxis } from "./constants";
import { qaToAnalyzerPayload } from "./qa";
import type { QAItem } from "./qa";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface AnalyzerInput {
  qa: QAItem[];
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
  qa?: QAItem[];
}

export function buildAnalyzerPrompt({ qa, axes }: AnalyzerInput): ChatMessage[] {
  const axisInstruction = axes.map((axis) => `- ${axis}: 0.0〜1.0で評価`).join("\n");
  const qaJson = qaToAnalyzerPayload(qa);

  const system = `あなたは恋愛観アナリストです。入力された質問と回答(JSON配列)から愛の価値観を評価し、指定された軸で0.0〜1.0のスコアと要約を出力します。
出力は必ずJSONのみ: {"summary_ja":"...", "scores":{"<axis>":0.0〜1.0}}
yes/no質問は「はい」「いいえ」で届き、Yesは+0.9、Noは-0.9を初期値として該当軸に割り当て、open回答の内容で最大±0.2程度の補正を加えてください。
スコアは0.0〜1.0の範囲に収めて小数第2位程度で示し、全軸を埋めます。要約は200字以内の自然な日本語で分析の要点を述べます。`;

  const user = `質問と回答(JSON):
${qaJson}

評価軸一覧:
${axisInstruction}

yes/no極性ヒント:
- Q2: はい→passion↑ / fleeting↑, いいえ→それぞれ↓
- Q3: はい→dependence↑ / autonomy↓, いいえ→逆
- Q5: はい→enduring↑ / fleeting↓, いいえ→逆
- Q7: はい→pragmatic↑ / poetic↓, いいえ→逆
- open回答で他軸のニュアンスを読み取り±0.2程度で補正し、全体の整合性を保つ`;

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

export function buildMatcherPrompt({
  summaryJa,
  scores,
  candidates,
  qa
}: MatcherInput): ChatMessage[] {
  const system = `あなたは恋愛観のキュレーターです。候補TopKから最適な3語を選び、各語について100〜140字の適合理由と30字以内のキャッチコピー(日本語)を出力します。
出力は必ずJSONのみ:
{"picks":[{"id":"...","term":"...","lang":"...","gloss":"...","reason_ja":"...","catch_ja":"..."}, ...]}
理由は常体で端的にまとめ、キャッチは語を含めてもよいが30字以内で完結させてください。`;

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

  const qaSection =
    qa && qa.length
      ? qa
          .map((item) => `Q${item.id} (${item.type}) ${item.text}\nA: ${item.answer}`)
          .join("\n\n")
      : null;

  const user = `診断要約:
${summaryJa}

スコア:
${scoreText}

${qaSection ? `回答一覧:\n${qaSection}\n\n` : ""}候補語彙:
${candidateText}

条件:
- 候補以外を選ばない
- 最適な語を関連度順で3つ選び、picks配列に上位から並べる。3つ未満しか適合しない場合は適切な件数で止める
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
