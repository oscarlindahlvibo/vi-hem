import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Button, Badge, PageHeader, EmptyState, LoadingPage } from '../components/ui';
import { formatDateTime } from '../lib/utils';
import { Notification } from '../types';
import {
  Bell,
  Check,
  CheckCheck,
  Wrench,
  MessageCircle,
  Clock,
  Newspaper,
  FileText,
  CalendarX,
  X,
} from 'lucide-react';

interface NotificationsPageProps { onNavigate: (page: string) => void; }
export function NotificationsPage({ onNavigate }: NotificationsPageProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);
      const notificationSince = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('vihem_notifications')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', notificationSince)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);

      // Retention cleanup is best-effort and never blocks the read.
      void supabase
        .from('vihem_notifications')
        .delete()
        .eq('user_id', user.id)
        .lt('created_at', notificationSince)
        .then(({ error: cleanupError }) => {
          if (cleanupError) console.warn('Notification retention cleanup skipped:', cleanupError);
        });
    } catch (error) {
      console.error('Error fetching vihem_notifications:', error);
      setErrorMessage('Aviseringarna kunde inte laddas just nu. Kontrollera anslutningen och försök igen.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchNotifications();
    if (!user?.id) return;

    // Set up real-time subscription
    const channel = supabase
      .channel('vihem_notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vihem_notifications',
          filter: `user_id=eq.${user?.id}`,
        },
        () => {
          void fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
    };
  }, [fetchNotifications, user?.id]);

  const markAsRead = async (notificationId: string) => {
    try {
      await supabase
        .from('vihem_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId);

      fetchNotifications();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await supabase
        .from('vihem_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user?.id)
        .is('read_at', null);

      fetchNotifications();
    } catch (error) {
      console.error('Error marking all vihem_notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await supabase
        .from('vihem_notifications')
        .delete()
        .eq('id', notificationId);

      fetchNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'maintenance':
        return <Wrench className="w-5 h-5 text-orange-600" />;
      case 'work_order':
        return <Wrench className="w-5 h-5 text-teal-600" />;
      case 'chat':
      case 'message':
        return <MessageCircle className="w-5 h-5 text-blue-600" />;
      case 'announcement':
        return <Newspaper className="w-5 h-5 text-purple-600" />;
      case 'document':
        return <FileText className="w-5 h-5 text-green-600" />;
      case 'absence':
        return <CalendarX className="w-5 h-5 text-amber-600" />;
      default:
        return <Bell className="w-5 h-5 text-gray-600" />;
    }
  };

  const getNotificationColor = (type: string): string => {
    switch (type) {
      case 'maintenance':
        return 'bg-orange-50 border-l-4 border-orange-600';
      case 'work_order':
        return 'bg-teal-50 border-l-4 border-teal-600';
      case 'chat':
      case 'message':
        return 'bg-blue-50 border-l-4 border-blue-600';
      case 'announcement':
        return 'bg-purple-50 border-l-4 border-purple-600';
      case 'document':
        return 'bg-green-50 border-l-4 border-green-600';
      case 'absence':
        return 'bg-amber-50 border-l-4 border-amber-600';
      default:
        return 'bg-gray-50 border-l-4 border-gray-600';
    }
  };

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  if (loading && notifications.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="Aviseringar" icon={Bell} />
        <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-20">
          <div className="text-center">
            <LoadingPage />
            <p className="-mt-16 text-sm text-gray-500">Laddar dina aviseringar...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="Aviseringar"
        icon={Bell}
        action={
          unreadCount > 0 && (
            <Button
              onClick={markAllAsRead}
              variant="primary"
              className="gap-2"
            >
              <CheckCheck size={18} />
              Markera alla som lästa
            </Button>
          )
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <Bell className="mx-auto h-8 w-8 text-red-500" />
            <h2 className="mt-3 font-semibold text-red-900">Kunde inte ladda aviseringar</h2>
            <p className="mt-1 text-sm text-red-700">{errorMessage}</p>
            <Button className="mt-4" onClick={() => void fetchNotifications()}>
              Försök igen
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Inga aviseringar"
            description="Du har ingen nya aviseringar"
          />
        ) : (
          <div className="space-y-4">
            {/* Unread count badge */}
            {unreadCount > 0 && (
              <div className="mb-6 flex items-center gap-2">
                <Badge
                  className="bg-blue-100 text-blue-800"
                  text={`${unreadCount} olästa avisering${unreadCount !== 1 ? 'ar' : ''}`}
                />
              </div>
            )}

            {/* Notifications list */}
            {notifications.map((notification: any) => (
              <div
                key={notification.id}
                className={`p-4 rounded-lg transition cursor-pointer hover:shadow-md ${
                  notification.read_at
                    ? getNotificationColor(notification.type)
                    : `${getNotificationColor(notification.type)} ring-2 ring-${notification.type === 'maintenance' ? 'orange' : notification.type === 'message' ? 'blue' : notification.type === 'announcement' ? 'purple' : 'green'}-200`
                }`}
                onClick={() => {
                  if (!notification.read_at) {
                    markAsRead(notification.id);
                  }
                  if (notification.link) onNavigate(notification.link);
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="mt-1 flex-shrink-0">
                      {getNotificationIcon(notification.type)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">
                          {notification.title}
                        </h3>
                        {!notification.read_at && (
                          <span className="inline-flex items-center justify-center w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>

                      <p className="text-sm text-gray-700 mb-2">
                        {notification.message}
                      </p>

                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Clock size={14} />
                        {formatDateTime(notification.created_at)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(notification.id);
                    }}
                    className="ml-4 text-gray-400 hover:text-gray-600 flex-shrink-0"
                  >
                    <X size={18} />
                  </button>
                </div>

                {!notification.read_at && (
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(notification.id);
                      }}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      <Check size={14} />
                      Markera som läst
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
