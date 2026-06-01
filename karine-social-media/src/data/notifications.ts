// Types partagés client/serveur (pas d'imports server-only ici).

export type NotificationType = 'new_post' | 'comment_reply' | 'idea_reply';

export type NotificationPayload = {
  /** Titre court affiché dans la liste. */
  title?: string;
  /** Corps facultatif (snippet). */
  body?: string;
  /** URL relative vers la cible (ex. /astuces?tip=xxx). */
  href?: string;
  /** Image/cover associée (ex. cover d'une astuce). */
  image?: string;
};

export type AppNotification = {
  id: number;
  type: NotificationType;
  payload: NotificationPayload;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
};
