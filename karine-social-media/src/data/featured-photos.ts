export type FeaturedPhoto = {
  id: number;
  imageUrl: string;
  caption: string | null;
  likesCount: number;
  sortOrder: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};
