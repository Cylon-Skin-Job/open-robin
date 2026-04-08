/**
 * @module TicketBoard
 * @role Three-column ticket board for the issues workspace
 * @reads ticketStore: tickets, loaded, activeTicket
 *
 * Columns determined by assignee + state (per TICKETING-SPEC):
 *   INBOX     — assigned to human (no matching bot)
 *   OPEN      — assigned to bot
 *   COMPLETED — state: closed (from done/ folder, not loaded yet)
 *
 * For now, only open tickets from the root are loaded.
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePanelData } from '../../hooks/usePanelData';
import { usePanelStore } from '../../state/panelStore';
import { useTicketStore, type Ticket } from '../../state/ticketStore';
import './tickets.css';

// Bot names we recognize — matches registry.json
const BOT_NAMES = new Set(['kimi-wiki', 'kimi-code', 'kimi-review', 'kimi-bot']);

function isBot(assignee: string): boolean {
  return BOT_NAMES.has(assignee);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return '';
  }
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const activeTicket = useTicketStore((s) => s.activeTicket);
  const setActive = useTicketStore((s) => s.setActiveTicket);
  const bot = isBot(ticket.assignee);

  return (
    <div
      className={`rv-ticket-card ${activeTicket === ticket.id ? 'active' : ''}`}
      onClick={() => setActive(activeTicket === ticket.id ? null : ticket.id)}
    >
      <div className="rv-ticket-card-id">{ticket.id}</div>
      <div className="rv-ticket-card-title">{ticket.title}</div>
      <div className="rv-ticket-card-meta">
        <span className={`rv-ticket-card-assignee ${bot ? 'rv-ticket-card-bot' : ''}`}>
          <span className="material-symbols-outlined">
            {bot ? 'smart_toy' : 'person'}
          </span>
          {ticket.assignee}
        </span>
        <span className="rv-ticket-card-time">{formatTime(ticket.created)}</span>
      </div>
    </div>
  );
}

function TicketDetail({ ticket }: { ticket: Ticket }) {
  const setActive = useTicketStore((s) => s.setActiveTicket);

  return (
    <div className="rv-ticket-detail" style={{ position: 'relative' }}>
      <button className="rv-ticket-detail-close" onClick={() => setActive(null)}>
        <span className="material-symbols-outlined">close</span>
      </button>
      <div className="rv-ticket-detail-header">
        <div className="rv-ticket-detail-id">{ticket.id}</div>
        <div className="rv-ticket-detail-title">{ticket.title}</div>
        <div className="rv-ticket-detail-fields">
          <span className="rv-ticket-detail-label">Assignee</span>
          <span className="rv-ticket-detail-value">{ticket.assignee}</span>
          <span className="rv-ticket-detail-label">State</span>
          <span className="rv-ticket-detail-value">{ticket.state}</span>
          <span className="rv-ticket-detail-label">Author</span>
          <span className="rv-ticket-detail-value">{ticket.author}</span>
          <span className="rv-ticket-detail-label">Created</span>
          <span className="rv-ticket-detail-value">{ticket.created}</span>
          {ticket.gitlab_iid && (
            <>
              <span className="rv-ticket-detail-label">GitLab</span>
              <span className="rv-ticket-detail-value">#{ticket.gitlab_iid}</span>
            </>
          )}
        </div>
      </div>
      <div className="rv-ticket-detail-body">
        {ticket.body || '(no description)'}
      </div>
    </div>
  );
}

function Column({ title, tickets, icon }: { title: string; tickets: Ticket[]; icon: string }) {
  return (
    <div className="rv-ticket-column">
      <div className="rv-ticket-column-header">
        <span className="rv-ticket-column-title">
          <span className="material-symbols-outlined">{icon}</span>
          {title}
        </span>
        <span className="rv-ticket-column-count">{tickets.length}</span>
      </div>
      <div className="rv-ticket-column-items">
        {tickets.length === 0 ? (
          <div className="rv-ticket-column-empty">No tickets</div>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} ticket={t} />)
        )}
      </div>
    </div>
  );
}

export function TicketBoard() {
  const ws = usePanelStore((s) => s.ws);
  const lastDailyWsRef = useRef<WebSocket | null>(null);

  const onIndex = useCallback((content: string) => {
    try {
      const index = JSON.parse(content);
      useTicketStore.getState().setTicketsFromIndex(index.tickets || {});
    } catch {
      useTicketStore.getState().setError('Failed to parse tickets.json');
    }
  }, []);

  const onError = useCallback((error: string) => {
    useTicketStore.getState().setError(error);
  }, []);

  usePanelData({
    panel: 'issues-viewer',
    indexPath: 'tickets.json',
    onIndex,
    onError,
  });

  // Open daily session on connect/reconnect.
  // Reset ref on cleanup so strict-mode remount re-sends.
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws === lastDailyWsRef.current) return;
    lastDailyWsRef.current = ws;
    ws.send(JSON.stringify({
      type: 'thread:open-daily',
      panel: 'issues-viewer',
    }));
    return () => {
      lastDailyWsRef.current = null;
    };
  }, [ws]);

  const tickets = useTicketStore((s) => s.tickets);
  const loaded = useTicketStore((s) => s.loaded);
  const activeTicketId = useTicketStore((s) => s.activeTicket);

  if (!loaded) {
    return (
      <div className="rv-ticket-board-loading">
        <span style={{ color: 'var(--text-dim)' }}>Loading tickets...</span>
      </div>
    );
  }

  const inbox = tickets.filter((t) => t.state === 'open' && !isBot(t.assignee));
  const open = tickets.filter((t) => t.state === 'open' && isBot(t.assignee));
  const completed = tickets.filter((t) => t.state === 'closed');

  const activeTicket = activeTicketId
    ? tickets.find((t) => t.id === activeTicketId) || null
    : null;

  return (
    <div className="rv-ticket-board">
      <Column title="Inbox" tickets={inbox} icon="inbox" />
      <Column title="Open" tickets={open} icon="play_circle" />
      {activeTicket ? (
        <TicketDetail ticket={activeTicket} />
      ) : (
        <Column title="Completed" tickets={completed} icon="check_circle" />
      )}
    </div>
  );
}
