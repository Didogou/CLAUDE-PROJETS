export type AdviceStatus = 'draft' | 'published';

export type Advice = {
  id: string; // slug
  label: string;
  slides: string[];
  tags: string[];
  likesCount: number;
  status: AdviceStatus;
  /** "Tout le monde" : accessible aux visiteuses non abonnées. */
  isPublic: boolean;
  publishedAt: string | null;
  createdAt: string;
};
