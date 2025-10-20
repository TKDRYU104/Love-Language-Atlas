export type QAItem = {
  id: number;
  type: "open" | "yesno" | "yesno+open" | "choice";
  text: string;
  answer: string;
};

export function qaToAnalyzerPayload(qa: QAItem[]): string {
  return JSON.stringify(qa);
}

export function qaToEmbeddingText(qa: QAItem[]): string {
  return qa.map((item) => `Q${item.id}:${item.text}\nAn:${item.answer}`).join("\n");
}
