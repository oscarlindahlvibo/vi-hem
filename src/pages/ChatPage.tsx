import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Button,
  Input,
  Modal,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatDateTime } from '../lib/utils';
import { ChatThread, ChatMessage } from '../types';
import { MessageCircle, Send, Plus, ChevronRight, X, Archive } from 'lucide-react';

interface ChatPageProps { onNavigate: (page: string) => void; }
export function ChatPage({ onNavigate: _onNavigate }: ChatPageProps) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [messageText, setMessageText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('all');
  const [searchTenant, setSearchTenant] = useState('');
  const [showMobileMessages, setShowMobileMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isStaff = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    fetchThreads();
  }, [statusFilter]);

  useEffect(() => {
    if (selectedThread) {
      fetchMessages(selectedThread.id);
      markThreadAsRead(selectedThread.id);
    }
  }, [selectedThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchThreads = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('chat_threads')
        .select('id, tenant_id, subject, last_message_at, status, tenant:profiles!chat_threads_tenant_id_fkey(id, name, email)')
        .order('last_message_at', { ascending: false });

      if (!isStaff) {
        query = query.eq('tenant_id', user?.id);
      }
      if (isStaff && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setThreads((data || []) as any);
    } catch (error) {
      console.error('Error fetching threads:', error);
    } finally {
      setLoading(false);
    }
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
      setMessages((data || []) as any);
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

  const createThread = async () => {
    if (!newSubject.trim() || !newMessage.trim()) return;
    try {
      const { data: threadData, error: threadError } = await supabase
        .from('chat_threads')
        .insert({
          tenant_id: user?.id,
          subject: newSubject,
          status: 'open',
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (threadError) throw threadError;

      await supabase.from('chat_messages').insert({
        thread_id: threadData.id,
        sender_id: user?.id,
        message: newMessage,
      });

      setNewSubject('');
      setNewMessage('');
      setShowCreateModal(false);
      fetchThreads();
    } catch (error) {
      console.error('Error creating thread:', error);
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !selectedThread) return;
    try {
      await supabase.from('chat_messages').insert({
        thread_id: selectedThread.id,
        sender_id: user?.id,
        message: messageText,
      });
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

  const filteredThreads = isStaff && searchTenant
    ? threads.filter((t: any) =>
        t.tenant?.name?.toLowerCase().includes(searchTenant.toLowerCase())
      )
    : threads;

  if (loading && threads.length === 0) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PageHeader
          title="Meddelanden"
          subtitle={isStaff ? 'Konversationer med hyresgäster' : 'Dina meddelanden med fastighetskontoret'}
          action={
            !isStaff ? (
              <Button onClick={() => setShowCreateModal(true)} variant="primary" className="gap-2">
                <Plus size={18} />
                Ny konversation
              </Button>
            ) : undefined
          }
        />

        <div className="flex gap-0 bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>
          {/* Left: Thread list */}
          <div className={`${showMobileMessages ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 border-r border-slate-200`}>
            {isStaff && (
              <div className="p-3 border-b border-slate-200 space-y-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Alla</option>
                  <option value="open">Öppna</option>
                  <option value="closed">Stängda</option>
                </select>
                <Input
                  placeholder="Sök hyresgäst..."
                  value={searchTenant}
                  onChange={(e) => setSearchTenant(e.target.value)}
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
                  {filteredThreads.map((thread: any) => (
                    <button
                      key={thread.id}
                      onClick={() => { setSelectedThread(thread); setShowMobileMessages(true); }}
                      className={`w-full p-4 text-left hover:bg-slate-50 transition-colors ${selectedThread?.id === thread.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate text-sm">
                            {isStaff ? (thread.tenant?.name || 'Okänd hyresgäst') : thread.subject}
                          </p>
                          {isStaff && (
                            <p className="text-xs text-slate-500 truncate">{thread.subject}</p>
                          )}
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

          {/* Right: Message view */}
          <div className={`${showMobileMessages ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}>
            {selectedThread ? (
              <>
                {/* Thread header */}
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
                      {(selectedThread as any).tenant?.name || 'Okänd'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {isStaff && (
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

                {/* Messages */}
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
                    messages.map((msg: any) => {
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

                {/* Input */}
                <div className="border-t border-slate-200 p-3 bg-white">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Skriv ett meddelande..."
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Button
                      onClick={sendMessage}
                      variant="primary"
                      disabled={!messageText.trim()}
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

      {/* Create Thread Modal */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Ny konversation">
        <div className="space-y-4">
          <Input
            label="Ämne"
            placeholder="Ange ämne för konversationen"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Meddelande</label>
            <textarea
              placeholder="Skriv ditt meddelande här..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={4}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)} className="flex-1">
              Avbryt
            </Button>
            <Button
              variant="primary"
              onClick={createThread}
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
