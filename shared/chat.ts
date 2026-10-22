import type { User } from './model';
export interface ChatReference {
  attemptId: string;
  questionId: string;
  label: string;
  href: string;
}
export interface ChatMessage {
  id: number;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  reference?: ChatReference;
  referenceUnavailable?: boolean;
}
export interface Conversation {
  id: string;
  peer: User;
  canSend: boolean;
  unread: number;
  updatedAt: string;
  lastMessage?: string;
  latestReceived?: { body: string; createdAt: string };
}
export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
}
