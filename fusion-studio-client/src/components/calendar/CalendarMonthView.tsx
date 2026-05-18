import React, { useLayoutEffect, useRef, useState } from 'react';
import { CalendarDayCell } from './CalendarDayCell';
import { useCalendarGrid, type CalendarEvent, type Calendar } from './useCalendarGrid';
import './CalendarViewer.css';

export interface CalendarMonthViewProps {
  baseDate: Date;
  events: CalendarEvent[];
  calendars: Calendar[];
  onMonthChange: (monthLabel: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  onDayDoubleClick: (date: Date) => void;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INITIAL_START_OFFSET = -5;
const INITIAL_END_OFFSET = 6;
const EXPAND_BY = 3;
const EXPAND_THRESHOLD = 4;

export const CalendarMonthView: React.FC<CalendarMonthViewProps> = ({
  baseDate,
  events,
  calendars,
  onMonthChange,
  onEventClick,
  onDayDoubleClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ startOffset: INITIAL_START_OFFSET, endOffset: INITIAL_END_OFFSET });
  const [visibleOffset, setVisibleOffset] = useState(0);
  const pendingScrollAdjust = useRef<{ oldScrollTop: number; oldScrollHeight: number } | null>(null);

  console.log('[CalendarMonthView] events count:', events.length, 'calendars count:', calendars.length);
  const gridMonths = useCalendarGrid(baseDate, events, calendars, range.startOffset, range.endOffset);
  console.log('[CalendarMonthView] gridMonths count:', gridMonths.length, 'total weeks:', gridMonths.reduce((acc, m) => acc + m.weeks.length, 0));
  const lastCenteredBaseDate = useRef<number | null>(null);

  // Center the scroll on the base month (offset 0) on initial load / when baseDate changes
  useLayoutEffect(() => {
    const baseTime = baseDate.getTime();
    if (lastCenteredBaseDate.current === baseTime) return;

    if (scrollRef.current) {
      const container = scrollRef.current;
      const monthHeight = container.scrollHeight / gridMonths.length;
      const targetScroll = monthHeight * (0 - range.startOffset);
      container.scrollTop = targetScroll;
      lastCenteredBaseDate.current = baseTime;
    }
  }, [baseDate, gridMonths.length, range.startOffset]);

  // Adjust scroll position after expanding up to prevent jumping
  useLayoutEffect(() => {
    if (pendingScrollAdjust.current && scrollRef.current) {
      const { oldScrollTop, oldScrollHeight } = pendingScrollAdjust.current;
      const newScrollHeight = scrollRef.current.scrollHeight;
      const diff = newScrollHeight - oldScrollHeight;
      scrollRef.current.scrollTop = oldScrollTop + diff;
      pendingScrollAdjust.current = null;
    }
  });

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = container;

    // Detection for visible month
    const monthHeight = scrollHeight / gridMonths.length;
    const currentIdx = Math.round(scrollTop / monthHeight);
    const offset = range.startOffset + currentIdx;

    if (offset !== visibleOffset) {
      setVisibleOffset(offset);
      const visibleDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
      const label = visibleDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      onMonthChange(label);
    }

    // Expand logic
    if (scrollTop < monthHeight * EXPAND_THRESHOLD) {
      pendingScrollAdjust.current = { oldScrollTop: scrollTop, oldScrollHeight: scrollHeight };
      setRange((prev) => ({ ...prev, startOffset: prev.startOffset - EXPAND_BY }));
    } else if (scrollTop + clientHeight > scrollHeight - monthHeight * EXPAND_THRESHOLD) {
      setRange((prev) => ({ ...prev, endOffset: prev.endOffset + EXPAND_BY }));
    }
  };

  const handleEventClick = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    onEventClick(event);
  };

  return (
    <div className="rv-calendar-month-view" ref={scrollRef} onScroll={handleScroll}>
      <div className="rv-calendar-weekday-headers">
        {DAY_HEADERS.map((day) => (
          <div key={day} className="rv-calendar-weekday-header">
            {day}
          </div>
        ))}
      </div>

      {gridMonths.map((month) => {
        return (
          <div key={month.monthLabel} className="rv-calendar-month-grid">
            <div className="rv-calendar-month-label">{month.monthName}</div>
            {month.weeks.map((week, wIdx) => (
              <div key={wIdx} className="rv-calendar-week">
                {week.days.map((day, dIdx) => (
                  <CalendarDayCell
                    key={dIdx}
                    date={day.date}
                    isOtherMonth={day.isOtherMonth}
                    isToday={day.isToday}
                    events={day.events}
                    onDoubleClick={() => day.date && onDayDoubleClick(day.date)}
                    onEventClick={(uid) => {
                      const event = events.find(e => e.uid === uid);
                      if (event) onEventClick(event);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default CalendarMonthView;
