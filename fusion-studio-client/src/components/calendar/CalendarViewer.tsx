import React, { useEffect, useState } from 'react';
import { useCalendarStore } from '../../state/calendarStore';
import type { CalendarEvent, EventFormData } from '../../types/calendar';
import { CalendarHeader, type CalendarDrawerView } from './CalendarHeader';
import { CalendarDrawer } from './CalendarDrawer';
import { CalendarMonthView } from './CalendarMonthView';
import { EventModal } from './EventModal';
import './CalendarViewer.css';

export const CalendarViewer: React.FC = () => {
  const calendars = useCalendarStore((s) => s.calendars);
  const events = useCalendarStore((s) => s.events);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const permissionDenied = useCalendarStore((s) => s.permissionDenied);
  const error = useCalendarStore((s) => s.error);
  const fetchCalendars = useCalendarStore((s) => s.fetchCalendars);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const toggleCalendarEnabled = useCalendarStore((s) => s.toggleCalendarEnabled);
  const createEvent = useCalendarStore((s) => s.createEvent);
  const updateEvent = useCalendarStore((s) => s.updateEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);

  const [drawerView, setDrawerView] = useState<CalendarDrawerView>('none');
  const [headerMonthLabel, setHeaderMonthLabel] = useState('');
  const [modalEvent, setModalEvent] = useState<CalendarEvent | undefined>(undefined);
  const [modalDate, setModalDate] = useState<Date | undefined>(undefined);

  useEffect(() => {
    fetchCalendars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDrawerToggle = (view: CalendarDrawerView) => {
    setDrawerView((current) => (current === view ? 'none' : view));
  };

  const handleMonthChange = (label: string) => {
    setHeaderMonthLabel(label);
  };

  const handlePrevMonth = () => {
    setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const handleEventClick = (event: CalendarEvent) => {
    setModalEvent(event);
    setModalDate(undefined);
  };

  const handleDayDoubleClick = (date: Date) => {
    setModalEvent(undefined);
    setModalDate(date);
  };

  const handleCloseModal = () => {
    setModalEvent(undefined);
    setModalDate(undefined);
  };

  const handleCreateEvent = (data: EventFormData) => {
    createEvent(data);
  };

  const handleUpdateEvent = (uid: string, data: EventFormData) => {
    updateEvent(uid, data);
  };

  const handleDeleteEvent = (uid: string) => {
    deleteEvent(uid);
    handleCloseModal();
  };

  function formatMonthYear(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  return (
    <div className="rv-calendar-page">
      <CalendarHeader
        monthLabel={headerMonthLabel || formatMonthYear(selectedDate)}
        selectedDate={selectedDate}
        drawerView={drawerView}
        onDrawerToggle={handleDrawerToggle}
        onViewChange={(v) => console.log('[CalendarViewer] view change:', v)}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onToday={handleToday}
      />

      {permissionDenied && (
        <div className="rv-calendar-permission-banner">
          <span className="material-symbols-outlined">lock</span>
          <span>
            Calendar access denied — showing demo data.{' '}
            {error ? `(${error})` : ''}
          </span>
        </div>
      )}

      <div className="rv-calendar-body">
        <div
          className={`rv-calendar-grid-container${
            drawerView !== 'none' ? ' rv-calendar-grid--drawer-open' : ''
          }`}
        >
          <CalendarMonthView
            baseDate={selectedDate}
            events={events}
            calendars={calendars}
            onMonthChange={handleMonthChange}
            onEventClick={handleEventClick}
            onDayDoubleClick={handleDayDoubleClick}
          />
        </div>
        <CalendarDrawer
          view={drawerView}
          calendars={calendars}
          onCalendarToggle={toggleCalendarEnabled}
          selectedDate={selectedDate}
          onMiniCalendarSelect={(date) => setSelectedDate(date)}
        />
      </div>

      {(modalEvent !== undefined || modalDate !== undefined) && (
        <EventModal
          event={modalEvent}
          initialDate={modalDate}
          calendars={calendars}
          onSave={handleCreateEvent}
          onUpdate={handleUpdateEvent}
          onDelete={handleDeleteEvent}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default CalendarViewer;
