// Delade typer för VI-HEM Mail (speglar svaren från edge function vihem-mail).
export interface MailAddress { name: string; email: string }
export interface MailAttachment { id: string; messageId: string; filename: string; mimeType: string; size: number; contentId: string | null; inline: boolean }
export interface ParsedMessage {
  id: string; threadId: string; labelIds: string[]; internalDate: number; snippet: string; from: MailAddress; to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[]; replyTo: MailAddress | null;
  subject: string; date: string; messageIdHeader: string; inReplyTo: string; references: string; html: string; text: string; attachments: MailAttachment[];
  unread: boolean; starred: boolean; isDraft: boolean; listUnsubscribe: string; deliveredTo: string[];
}
export interface ThreadSummary {
  id: string; subject: string; snippet: string; participants: MailAddress[]; from: MailAddress; lastDate: number; messageCount: number; unread: boolean; starred: boolean; hasAttachments: boolean; labelIds: string[]; draft: boolean; important: boolean;
  account_id?: string; account_email?: string;
}
export interface MailLevels { read: boolean; send: boolean; manage: boolean; admin: boolean }
export interface MailAccount { id: string; email: string; display_name: string; description: string; kind: 'personal' | 'shared'; is_owner: boolean; levels: MailLevels }
export interface SendAsIdentity { email: string; name: string; replyTo: string; signature: string; isPrimary: boolean; isDefault: boolean; verified: boolean; treatAsAlias: boolean }
export interface GmailLabel { id: string; name: string; type: 'system' | 'user'; color?: { backgroundColor?: string; textColor?: string }; threadsUnread?: number; threadsTotal?: number }
export interface MailPrefs { last_sender: Record<string, string>; notify_mode: 'none' | 'all' | 'important' | 'shared' | 'assigned'; notify_show_sender: boolean; load_remote_images: 'never' | 'ask' | 'always'; important_senders: string[]; default_account_id: string | null; notify_account_ids: string[] | null }
