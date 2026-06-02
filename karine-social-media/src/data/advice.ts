export type AdviceStatus = 'draft' | 'published';

export type Advice = {
  id: string; // slug
  label: string;
  slides: string[];
  tags: string[];
  likesCount: number;
  status: AdviceStatus;
  publishedAt: string | null;
  createdAt: string;
};
