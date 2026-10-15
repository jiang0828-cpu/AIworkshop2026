export type ReviewSource = { targetType: string; targetId: string; sourceType: string; sourceId: string; sourceTitle: string };

export function reviewSources(sources: ReviewSource[], reviewId?: string) {
  return sources.filter(source => source.targetType === "review" && source.targetId === reviewId && ["project", "action", "dailyTask"].includes(source.sourceType));
}
