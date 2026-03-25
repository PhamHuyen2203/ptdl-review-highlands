/** Cảm xúc theo sao (rating_sentiment) vs theo chữ (sentiment_score + sentiment_label). */

export type SentKind = 'positive' | 'negative' | 'neutral';

function normLabel(s?: string | null): SentKind {
  if (s === 'positive') return 'positive';
  if (s === 'negative') return 'negative';
  return 'neutral';
}

/**
 * Phía “chữ”: sentiment_score trong DB thường trong [-1, 1] (có nhiều giá trị nhỏ như -0.03).
 * - |score| lớn → xếp loại theo điểm.
 * - Vùng mơ hồ (-0.2, 0.2) → tin sentiment_label (phân loại nội dung) hơn là ép neutral từ score nhỏ.
 */
export function textSentimentKind(
  score: number | null | undefined,
  sentimentLabel?: string | null,
  ratingSentiment?: string | null
): SentKind {
  const s = score;
  if (typeof s === 'number' && !Number.isNaN(s)) {
    if (s >= 0.2) return 'positive';
    if (s <= -0.2) return 'negative';
  }
  const byLabel = normLabel(sentimentLabel);
  if (byLabel !== 'neutral') return byLabel;
  return normLabel(ratingSentiment);
}

export function starSentimentKind(ratingSentiment?: string | null): SentKind {
  return normLabel(ratingSentiment);
}

export function sentimentPair(r: {
  rating_sentiment?: string | null;
  sentiment_score?: number | null;
  sentiment_label?: string | null;
}): { star: SentKind; text: SentKind; agree: boolean } {
  const star = starSentimentKind(r.rating_sentiment);
  const text = textSentimentKind(
    r.sentiment_score ?? undefined,
    r.sentiment_label ?? undefined,
    r.rating_sentiment ?? undefined
  );
  return { star, text, agree: star === text };
}

export function sentimentVn(k: SentKind): string {
  if (k === 'positive') return 'Tích cực';
  if (k === 'negative') return 'Tiêu cực';
  return 'Trung lập';
}

export function sentimentBadgeClass(k: SentKind): string {
  if (k === 'positive') return 'badge-positive';
  if (k === 'negative') return 'badge-negative';
  return 'badge-neutral';
}

/** Icon Bootstrap cho phía sao (rating_sentiment). */
export function starSentimentIcon(k: SentKind): string {
  if (k === 'positive') return 'bi-emoji-smile-fill';
  if (k === 'negative') return 'bi-emoji-frown-fill';
  return 'bi-emoji-neutral';
}
