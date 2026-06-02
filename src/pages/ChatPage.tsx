import React, { useEffect, useRef, useState } from 'react';
import { Archive, ChevronRight, MessageCircle, Plus, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Button,
  EmptyState,
  Input,
  LoadingPage,
  Modal,
  PageHeader,
} from '../components/ui';
import { formatDateTime } from '../lib/utils';
import type { ChatMessage, ChatThread, Profile } from '../types';

interface ChatPageProps {
  onNavigate: (page: string) => void;
}

type ChatMode = 'tenant' | 'staff' | 'group';

type ThreadUser = Pick<Profile, 'id' | 'name' | 'email' | 'role'>;

type ChatThreadWithRelations = ChatThread & {
  tenant?: ThreadUser | null;
  participants?: {
    id: string;
    user_id: string;
    user?: ThreadUser | null;
  }[];
};

export function ChatPage({ onNavigate: _onNavigate }: ChatPageProps) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThreadWithRelations[]>([]);
  const [selectedThread, setSelectedThread] = useState<ChatThreadWithRelations | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingThread, setCreatingThread] = useState(false);
  const [createError, setCreateError] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('tenant');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [messageText, setMessageText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileMessages, setShowMobileMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isStaff = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    fetchThreads();
  }, [statusFilter, user?.id]);

  useEffect(() => {
    if (isStaff) fetchAvailableUsers();
  }, [isStaff, user?.organisation_id]);

  useEffect(() => {
    if (!selectedThread) return;
    fetchMessages(selectedThread.id);
    markThreadAsRead(selectedThread.id);
  }, [selectedThread?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchThreads = async () => {
    if (!user) return;

    try {
      setLoading(true);
      let query = supabase
        .from('chat_threads')
        .select(`
          id,
          organisation_id,
          tenant_id,
          assigned_to,
          chat_type,
          created_by,
          subject,
          status,
          maintenance_request_id,
          last_message_at,
          created_at,
          tenant:profiles!chat_threads_tenant_id_fkey(id, name, email, role),
          participants:chat_participants(id, user_id, user:profiles!chat_participants_user_id_fkey(id, name, email, role))
        `)
        .order('last_message_at', { ascending: false });

      if (!isStaff) {
        query = query.eq('tenant_id', user.id).eq('chat_type', 'tenant_support');
      }

      if (isStaff && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      setThreads((data || []) as ChatThreadWithRelations[]);
    } catch (error) {
      console.error('Error fetching threads:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableUsers = async () => {
    if (!user?.organisation_id) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('organisation_id', user.organisation_id)
      .eq('active', true)
      .in('role', ['tenant', 'staff', 'admin'])
      .order('name');

    if (error) {
      console.error('Error fetching chat users:', error);
      return;
    }

    setAvailableUsers((data || []) as Profile[]);
  };

  const fetchMessages = async (threadId: string) => {
    try {
      setMessagesLoading(true);
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, thread_id, sender_id, message, created_at, read_at, sender:profiles!chat_messages_sender_id_fkey(id, name)')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []) as ChatMessage[]);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setMessagesLoading(false);
    }
  };

  const markThreadAsRead = async (threadId: string) => {
    try {
      await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .neq('sender_id', user?.id)
        .is('read_at', null);
    } catch (error) {
      console.error('Error marking thread as read:', error);
    }
  };

  const getThreadParticipants = (thread: ChatThreadWithRelations) =>
    (thread.participants || [])
      .map((participant) => participant.user)
      .filter(Boolean) as ThreadUser[];

  const getThreadTitle = (thread: ChatThreadWithRelations) => {
    if (!isStaff) return thread.subject;
    if (thread.chat_type === 'tenant_support') return thread.tenant?.name || 'Okänd hyresgäst';

    const otherParticipants = getThreadParticipants(thread).filter((participant) => participant.id !== user?.id);
    if (thread.chat_type === 'group') return thread.subject || otherParticipants.map((participant) => participant.name).join(', ');
    return otherParticipants[0]?.name || thread.subject || 'Direktchatt';
  };

  const getThreadSubtitle = (thread: ChatThreadWithRelations) => {
    if (thread.chat_type === 'group') return `${getThreadParticipants(thread).length} deltagare`;
    if (thread.chat_type === 'direct') return 'Personalchatt';
    return thread.subject;
  };

  const filteredThreads = searchQuery
    ? threads.filter((thread) =>
        getThreadTitle(thread).toLowerCase().includes(searchQuery.toLowerCase()) ||
        thread.subject.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : threads;

  const selectableUsers = isStaff
    ? availableUsers.filter((candidate) => {
        if (candidate.id === user?.id) return false;
        if (chatMode === 'tenant') return candidate.role === 'tenant';
        if (chatMode === 'staff') return candidate.role !== 'tenant';
        return true;
      })
    : [];

  const toggleSelectedUser = (userId: string) => {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  };

  const resetCreateModal = () => {
    setShowCreateModal(false);
    setCreateError('');
    setCreatingThread(false);
    setChatMode('tenant');
    setSelectedUserIds([]);
    setNewSubject('');
    setNewMessage('');
  };

  const createThread = async () => {
    if (!user || !newSubject.trim() || !newMessage.trim()) return;

    try {
      setCreatingThread(true);
      setCreateError('');

      const selectedUsers = availableUsers.filter((candidate) => selectedUserIds.includes(candidate.id));
      const tenantRecipients = selectedUsers.filter((candidate) => candidate.role === 'tenant');
      const staffRecipients = selectedUsers.filter((candidate) => candidate.role !== 'tenant');

      if (isStaff && selectedUserIds.length === 0) {
        setCreateError('Välj minst en mottagare.');
        return;
      }

      if (isStaff && chatMode === 'tenant' && (selectedUserIds.length !== 1 || tenantRecipients.length !== 1)) {
        setCreateError('Välj exakt en hyresgäst.');
        return;
      }

      if (isStaff && chatMode === 'staff' && (selectedUserIds.length !== 1 || tenantRecipients.length > 0)) {
        setCreateError('Välj exakt en person i personalen.');
        return;
      }

      if (isStaff && chatMode === 'group' && selectedUserIds.length < 2) {
        setCreateError('Välj minst två deltagare för en gruppchatt.');
        return;
      }

      if (isStaff && chatMode === 'group' && tenantRecipients.length > 1) {
        setCreateError('En gruppchatt kan inte innehålla flera hyresgäster.');
        return;
      }

      const now = new Date().toISOString();
      const tenantRecipient = tenantRecipients[0];
      const threadType = isStaff
        ? chatMode === 'group'
          ? 'group'
          : chatMode === 'staff'
            ? 'direct'
            : 'tenant_support'
        : 'tenant_support';

      const { data: threadData, error: threadError } = await supabase
        .from('chat_threads')
        .insert({
          tenant_id: isStaff ? tenantRecipient?.id || null : user.id,
          assigned_to: isStaff && staffRecipients.length === 1 ? staffRecipients[0].id : null,
          organisation_id: user.organisation_id,
          chat_type: threadType,
          created_by: user.id,
          subject: newSubject.trim(),
          status: 'open',
          last_message_at: now,
        })
        .select('id')
        .single();

      if (threadError) throw threadError;

      const participantIds = new Set<string>([user.id]);
      if (isStaff) selectedUserIds.forEach((id) => participantIds.add(id));

      const { error: participantError } = await supabase
        .from('chat_participants')
        .insert([...participantIds].map((userId) => ({ thread_id: threadData.id, user_id: userId })));

      if (participantError) throw participantError;

      const { error: messageError } = await supabase.from('chat_messages').insert({
        thread_id: threadData.id,
        sender_id: user.id,
        message: newMessage.trim(),
      });

      if (messageError) throw messageError;

      resetCreateModal();
      fetchThreads();
    } catch (error) {
      console.error('Error creating thread:', error);
      setCreateError('Kunde inte skapa chatten. Försök igen.');
    } finally {
      setCreatingThread(false);
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !selectedThread || !user) return;

    try {
      const { error: messageError } = await supabase.from('chat_messages').insert({
        thread_id: selectedThread.id,
        sender_id: user.id,
        message: messageText.trim(),
      });
      if (messageError) throw messageError;

      await supabase
        .from('chat_threads')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', selectedThread.id);

      setMessageText('');
      fetchMessages(selectedThread.id);
      fetchThreads();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const closeThread = async (threadId: string) => {
    try {
      await supabase.from('chat_threads').update({ status: 'closed' }).eq('id', threadId);
      setSelectedThread(null);
      fetchThreads();
    } catch (error) {
      console.error('Error closing thread:', error);
    }
  };

  if (loading && threads.length === 0) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PageHeader
          title="Meddelanden"
          subtitle={isStaff ? 'Konversationer med hyresgäster och kollegor' : 'Dina meddelanden med fastighetskontoret'}
          action={
            <Button onClick={() => setShowCreateModal(true)} variant="primary" className="gap-2">
              <Plus size={18} />
              {isStaff ? 'Ny chatt' : 'Ny konversation'}
            </Button>
          }
        />

        <div className="flex gap-0 bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>
          <div className={`${showMobileMessages ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 border-r border-slate-200`}>
            {isStaff && (
              <div className="p-3 border-b border-slate-200 space-y-2">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as 'open' | 'closed' | 'all')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Alla</option>
                  <option value="open">Öppna</option>
                  <option value="closed">Stängda</option>
                </select>
                <Input
                  placeholder="Sök konversation..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {filteredThreads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-6">
                  <EmptyState
                    icon={<MessageCircle className="w-10 h-10" />}
                    title="Inga konversationer"
                    description="Du har inga meddelanden än"
                  />
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredThreads.map((thread) => (
                    <button
                      key={thread.id}
                      onClick={() => { setSelectedThread(thread); setShowMobileMessages(true); }}
                      className={`w-full p-4 text-left hover:bg-slate-50 transition-colors ${selectedThread?.id === thread.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate text-sm">{getThreadTitle(thread)}</p>
                          <p className="text-xs text-slate-500 truncate">{getThreadSubtitle(thread)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-400">{formatDateTime(thread.last_message_at)}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${thread.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                              {thread.status === 'open' ? 'Öppen' : 'Stängd'}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`${showMobileMessages ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}>
            {selectedThread ? (
              <>
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between bg-white">
                  <div>
                    <button
                      onClick={() => setShowMobileMessages(false)}
                      className="md:hidden mb-1 flex items-center gap-1 text-blue-600 text-xs font-medium"
                    >
                      ← Tillbaka
                    </button>
                    <h2 className="font-semibold text-slate-900 text-sm">{selectedThread.subject}</h2>
                    <p className="text-xs text-slate-500">
                      {isStaff ? getThreadTitle(selectedThread) : 'Fastighetskontoret'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {isStaff && selectedThread.status === 'open' && (
                      <Button variant="secondary" size="sm" onClick={() => closeThread(selectedThread.id)} className="gap-1">
                        <Archive size={14} />
                        Stäng
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => { setSelectedThread(null); setShowMobileMessages(false); }}>
                      <X size={14} />
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-32">
                      <EmptyState
                        icon={<MessageCircle className="w-8 h-8" />}
                        title="Inga meddelanden"
                        description="Starta konversationen"
                      />
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isOwn = msg.sender_id === user?.id;
                      return (
                        <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${isOwn ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-slate-900 border border-slate-200 rounded-bl-sm shadow-sm'}`}>
                            {!isOwn && (
                              <p className="text-xs font-semibold mb-1 opacity-60">{msg.sender?.name}</p>
                            )}
                            <p className="break-words leading-relaxed">{msg.message}</p>
                            <p className={`text-xs mt-1 ${isOwn ? 'text-blue-200' : 'text-slate-400'}`}>
                              {formatDateTime(msg.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="border-t border-slate-200 p-3 bg-white">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={selectedThread.status === 'open' ? 'Skriv ett meddelande...' : 'Konversationen är stängd'}
                      value={messageText}
                      disabled={selectedThread.status !== 'open'}
                      onChange={(event) => setMessageText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          sendMessage();
                        }
                      }}
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <Button
                      onClick={sendMessage}
                      variant="primary"
                      disabled={!messageText.trim() || selectedThread.status !== 'open'}
                      className="rounded-full aspect-square px-3"
                    >
                      <Send size={16} />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <MessageCircle className="w-8 h-8 text-slate-400" />
                </div>
                <p className="font-medium text-slate-700">Välj en konversation</p>
                <p className="text-sm text-slate-400 mt-1">Klicka på en konversation för att börja chatta</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={showCreateModal} onClose={resetCreateModal} title={isStaff ? 'Ny chatt' : 'Ny konversation'} size="lg">
        <div className="space-y-4">
          {isStaff && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'tenant', label: 'Hyresgäst' },
                  { value: 'staff', label: 'Personal' },
                  { value: 'group', label: 'Grupp' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setChatMode(option.value as ChatMode);
                      setSelectedUserIds([]);
                      setCreateError('');
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${chatMode === option.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 max-h-56 overflow-y-auto">
                {selectableUsers.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Inga mottagare att välja.</p>
                ) : (
                  selectableUsers.map((candidate) => {
                    const checked = selectedUserIds.includes(candidate.id);
                    const singleSelect = chatMode !== 'group';
                    return (
                      <label key={candidate.id} className="flex items-center gap-3 p-3 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50">
                        <input
                          type={singleSelect ? 'radio' : 'checkbox'}
                          checked={checked}
                          onChange={() => {
                            setSelectedUserIds(singleSelect ? [candidate.id] : selectedUserIds);
                            if (!singleSelect) toggleSelectedUser(candidate.id);
                          }}
                          className="w-4 h-4"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800 truncate">{candidate.name}</span>
                          <span className="block text-xs text-slate-500 truncate">
                            {candidate.email} · {candidate.role === 'tenant' ? 'Hyresgäst' : candidate.role === 'admin' ? 'Admin' : 'Personal'}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>

              {chatMode === 'group' && (
                <p className="text-xs text-slate-500">
                  Gruppchattar kan innehålla personal och högst en hyresgäst. Hyresgäster kan aldrig starta eller delta i chattar med andra hyresgäster.
                </p>
              )}
            </>
          )}

          <Input
            label="Ämne"
            placeholder="Ange ämne för konversationen"
            value={newSubject}
            onChange={(event) => setNewSubject(event.target.value)}
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Meddelande</label>
            <textarea
              placeholder="Skriv ditt meddelande här..."
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={4}
            />
          </div>

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {createError}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={resetCreateModal} className="flex-1">
              Avbryt
            </Button>
            <Button
              variant="primary"
              onClick={createThread}
              loading={creatingThread}
              disabled={!newSubject.trim() || !newMessage.trim()}
              className="flex-1"
            >
              Skicka
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
