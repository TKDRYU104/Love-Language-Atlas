export type LoveWord = {
  id: string;
  term: string;
  lang: string;
  gloss: string;
  tags?: string[];
  culture_note?: string;
};

export type AnalyzerPayload = {
  summary_ja: string;
  scores: Record<string, number>;
};

export type MatcherPick = {
  id: string;
  term: string;
  lang: string;
  gloss?: string;
  reason_ja: string;
  catch_ja: string;
};
