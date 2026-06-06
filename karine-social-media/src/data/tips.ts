export type TipStatus = 'draft' | 'published';

export type Tip = {
  id: string; // slug
  label: string;
  slides: string[]; // URLs publiques, la 1ère sert de cover polaroid
  tags: string[];
  likesCount: number;
  status: TipStatus;
  /** "Tout le monde" : accessible aux visiteuses non abonnées. */
  isPublic: boolean;
  publishedAt: string | null;
  createdAt: string;
};
