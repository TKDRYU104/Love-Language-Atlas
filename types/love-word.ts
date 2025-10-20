import type { LoveAxis } from "@/lib/constants";

export interface LoveWord {
  id: string;
  lang: string;
  term: string;
  gloss: string;
  axes: Record<LoveAxis, number>;
  tags?: string[];
  culture_note?: string;
  phase?: string;
}
