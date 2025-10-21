export type QA = { id: number; type: string; text: string; answer?: string };

const EMOTION = ["うれし", "寂し", "切な", "痛", "安心", "落ち着", "ドキ", "震え", "怖", "ほっと", "愛し"];
const ACTION = ["待つ", "抱き", "手紙", "見守", "話", "変わ", "寄り添", "離れ", "信じ", "謝", "支え"];
const SENSORY = ["夕焼け", "香り", "静けさ", "余韻", "影", "風", "光", "鼓動", "温度", "雨音", "湯気"];

export function extractExcerpts(qa: QA[], maxExcerpts = 2): string[] {
  const texts = qa
    .filter(
      (q) =>
        (q.type === "open" || q.type?.startsWith("yesno+open")) && (q.answer?.trim().length ?? 0) > 0,
    )
    .map((q) => normJa(q.answer!.trim()));

  const candidates = texts.flatMap(splitToPhrases).map(maskPII).filter(isReasonableLength);
  const scored = candidates.map((c) => ({ text: c, score: scorePhrase(c) }));

  const picked: string[] = [];
  for (const { text } of scored.sort((a, b) => b.score - a.score)) {
    if (picked.length >= maxExcerpts) break;
    if (picked.every((p) => jaccard(p, text) < 0.6)) picked.push(text);
  }

  if (picked.length === 0) {
    const fallback = texts.map((t) => compress(t)).find((t) => t.length >= 20);
    if (fallback) picked.push(toPeriod(fallback.slice(0, 40)));
  }

  return picked.map(toPeriod);
}

function normJa(s: string) {
  return s.replace(/\s+/g, " ").replace(/[ 　]+/g, " ").trim();
}

function splitToPhrases(s: string): string[] {
  const raw = s
    .split(/[。！？!?]/)
    .flatMap((seg) => seg.split(/[、,]/))
    .map((x) => x.trim())
    .filter(Boolean);
  const res: string[] = [];
  for (const seg of raw) {
    if (seg.length >= 20 && seg.length <= 48) {
      res.push(seg);
    } else if (seg.length > 48) {
      for (let i = 0; i < seg.length; i += 36) {
        const chunk = seg.slice(i, i + 42);
        if (chunk.length >= 20) res.push(chunk);
      }
    }
  }
  return res;
}

function maskPII(s: string) {
  return s
    .replace(/@[0-9A-Za-z_.]+/g, "@…")
    .replace(/[0-9A-Za-z._%+-]+@[0-9A-Za-z.-]+\.[A-Za-z]{2,}/g, "［連絡先］")
    .replace(/\b0\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4}\b/g, "［連絡先］")
    .replace(/(.{0,8})(市|区|町|村|駅)\b/g, "［場所］")
    .replace(/([一-龥々]{1,4}|[ぁ-んァ-ン]{2,4})(さん|くん|ちゃん)/g, "［名前］");
}

function isReasonableLength(s: string) {
  const len = s.length;
  const latin = (s.match(/[A-Za-z0-9]/g) || []).length;
  return len >= 16 && len <= 60 && latin <= Math.ceil(len * 0.1);
}

function scorePhrase(s: string) {
  const emo = density(s, EMOTION);
  const act = hasAny(s, ACTION) ? 1 : 0;
  const sen = density(s, SENSORY);
  const len = Math.min(1, Math.max(0, (s.length - 18) / (44 - 18)));
  return 0.35 * emo + 0.25 * act + 0.2 * sen + 0.2 * len;
}

function density(s: string, dict: string[]) {
  const hits = dict.reduce((acc, k) => acc + (s.includes(k) ? 1 : 0), 0);
  return Math.min(1, hits / 2);
}

function hasAny(s: string, dict: string[]) {
  return dict.some((k) => s.includes(k));
}

function jaccard(a: string, b: string) {
  const sa = new Set(a.split(""));
  const sb = new Set(b.split(""));
  const inter = Array.from(sa).filter((ch) => sb.has(ch)).length;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function compress(s: string) {
  return s.replace(/(です|ます|でした|だと思う|かな|かも)/g, "").replace(/\s+/g, " ").trim();
}

function toPeriod(s: string) {
  return /[。.!？?]$/.test(s) ? s : s + "。";
}
