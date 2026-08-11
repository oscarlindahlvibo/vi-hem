import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { flushOfflineQueue, getOfflineQueue, subscribeOfflineQueue } from '../lib/offlineQueue';

export function OfflineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queueState, setQueueState] = useState({ pending: 0, conflicts: 0 });

  useEffect(() => {
    const refresh = async () => {
      const queue = await getOfflineQueue();
      setQueueState({ pending: queue.length, conflicts: queue.filter(item => item.status === 'conflict').length });
    };
    const onlineHandler = () => { setOnline(true); void flushOfflineQueue().then(refresh); };
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    const unsubscribe = subscribeOfflineQueue(() => void refresh());
    void flushOfflineQueue().then(refresh);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
      unsubscribe();
    };
  }, []);

  if (online && queueState.pending === 0) return null;
  const label = queueState.conflicts > 0
    ? `${queueState.conflicts} konflikt${queueState.conflicts === 1 ? '' : 'er'} kräver kontroll`
    : online
      ? `Synkar ${queueState.pending} ändring${queueState.pending === 1 ? '' : 'ar'}`
      : 'Offline';
  return (
    <div className={`fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold shadow-lg ${queueState.conflicts > 0 ? 'bg-red-100 text-red-800' : online ? 'bg-amber-100 text-amber-800' : 'bg-slate-900 text-white'}`}>
      {queueState.conflicts > 0 ? <CloudOff className="h-4 w-4" /> : online ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CloudOff className="h-4 w-4" />}
      <span>{label}</span>
      {!online && <Cloud className="h-4 w-4 opacity-70" />}
    </div>
  );
}
