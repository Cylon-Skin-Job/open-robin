/**
 * @module ticketStore
 * @role State management for the ticket-board workspace
 * @reads tickets.json via file_content_request (same pattern as wikiStore)
 */

import { create } from 'zustand';

export interface Ticket {
  id: string;
  title: string;
  assignee: string;
  created: string;
  author: string;
  state: string;
  gitlab_iid?: string;
  body: string;
}

export interface TicketState {
  tickets: Ticket[];
  loaded: boolean;
  activeTicket: string | null;
  error: string | null;

  setTicketsFromIndex: (tickets: Record<string, Omit<Ticket, 'id'>>) => void;
  setActiveTicket: (id: string | null) => void;
  setError: (error: string | null) => void;
}

export const useTicketStore = create<TicketState>((set) => ({
  tickets: [],
  loaded: false,
  activeTicket: null,
  error: null,

  setTicketsFromIndex: (ticketMap) => {
    const tickets = Object.entries(ticketMap).map(([id, data]) => ({
      id,
      ...data,
    }));
    set({ tickets, loaded: true });
  },
  setActiveTicket: (id) => set({ activeTicket: id }),
  setError: (error) => set({ error }),
}));
