export type IdeaType = 'recette' | 'astuce' | 'question';
export type IdeaStatus = 'new' | 'replied' | 'archived';

export type Idea = {
  id: number;
  userId: string;
  type: IdeaType;
  title: string;
  body: string;
  status: IdeaStatus;
  reply: string | null;
  repliedAt: string | null;
  repliedBy: string | null;
  createdAt: string;
};

export type IdeaWithAuthor = Idea & {
  authorEmail: string | null;
  authorName: string | null;
};

export const IDEA_TYPE_LABELS: Record<IdeaType, string> = {
  recette: 'Idée de recette',
  astuce: 'Idée d’astuce',
  question: 'Question',
};
