import { useCallback, useEffect, useState } from 'react';
import { api, type StatusResponse } from './api.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { Groups } from './pages/Groups.tsx';
import { History } from './pages/History.tsx';
import { Rules } from './pages/Rules.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { Templates } from './pages/Templates.tsx';

const PAGES = [
  { id: 'dashboard', label: 'Panel' },
  { id: 'groups', label: 'Gruplar' },
  { id: 'rules', label: 'Kurallar' },
  { id: 'templates', label: 'Sablonlar' },
  { id: 'history', label: 'Gecmis' },
  { id: 'settings', label: 'Ayarlar' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('dashboard');
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    // Canli akis durumu zaten itiyor; bu yalnizca akis koparsa yedek.
    const timer = setInterval(() => void refreshStatus(), 30_000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>FB Grup Izleyici</h1>
        {PAGES.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? 'active' : ''}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {page === 'dashboard' && <Dashboard status={status} onStatusChange={refreshStatus} />}
        {page === 'groups' && <Groups />}
        {page === 'rules' && <Rules />}
        {page === 'templates' && <Templates />}
        {page === 'history' && <History />}
        {page === 'settings' && <SettingsPage onSaved={refreshStatus} />}
      </main>
    </div>
  );
}
