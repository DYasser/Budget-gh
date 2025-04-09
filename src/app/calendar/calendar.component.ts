import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { CalendarModule, CalendarView, CalendarEvent, DateAdapter } from 'angular-calendar';
import { Subscription } from 'rxjs';
import { addMonths, subMonths, lastDayOfMonth, parseISO, addWeeks, addYears, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isWithinInterval, addDays, getMonth, getYear, format, startOfDay, endOfDay } from 'date-fns';
import { getMonthView } from 'calendar-utils';
import { BudgetService, ExpenseCategory, BudgetFrequency } from '../budget.service';

interface EventColor { primary: string; secondary: string; }

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [ CommonModule, CalendarModule, CurrencyPipe ],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CalendarComponent implements OnInit, OnDestroy {

  view: CalendarView = CalendarView.Month;
  CalendarView = CalendarView;
  viewDate: Date = new Date();
  events: CalendarEvent<{ category: ExpenseCategory }>[] = [];
  receiptEventsThisMonth: CalendarEvent<{ category: ExpenseCategory }>[] = [];
  allCategories: ExpenseCategory[] = [];
  private categoriesSubscription!: Subscription;
  receiptTotalAmount: number = 0;

  constructor(
    private budgetService: BudgetService,
    private cdr: ChangeDetectorRef,
    private dateAdapter: DateAdapter
  ) {}

  ngOnInit(): void {
    this.categoriesSubscription = this.budgetService.categories$.subscribe(categories => {
      this.allCategories = categories;
      this.refreshCalendarData();
    });
  }

  ngOnDestroy(): void {
    if (this.categoriesSubscription) {
      this.categoriesSubscription.unsubscribe();
    }
  }

  private getViewPeriod(): { viewStart: Date, viewEnd: Date } {
     if (this.view === CalendarView.Month) {
        const view = getMonthView(this.dateAdapter, { events: [], viewDate: this.viewDate, weekStartsOn: 0 });
        return { viewStart: view.period.start, viewEnd: view.period.end };
     } else if (this.view === CalendarView.Week) {
        const viewStart = startOfWeek(this.viewDate); const viewEnd = endOfWeek(this.viewDate);
        return { viewStart, viewEnd };
     } else {
        return { viewStart: startOfDay(this.viewDate), viewEnd: endOfDay(this.viewDate) };
     }
  }

  private refreshCalendarData(): void {
    if (!this.allCategories) {
        this.events = []; this.receiptEventsThisMonth = []; this.receiptTotalAmount = 0; this.cdr.markForCheck(); return;
    };

    const viewPeriod = this.getViewPeriod();
    const currentViewMonth = this.viewDate.getMonth();
    const currentViewYear = this.viewDate.getFullYear();

    this.events = this.budgetService.getCalendarEventsForPeriod(this.allCategories, { start: viewPeriod.viewStart, end: viewPeriod.viewEnd });

    this.receiptEventsThisMonth = this.events.filter(event => {
        try {
            return event.start.getMonth() === currentViewMonth && event.start.getFullYear() === currentViewYear;
        } catch { return false; }
    });

    this.receiptTotalAmount = this.receiptEventsThisMonth.reduce((sum, event) => sum + (event.meta?.category?.budget || 0), 0);

    this.cdr.markForCheck();
  }

  setView(view: CalendarView): void { this.view = view; this.refreshCalendarData(); }
  goToPreviousMonth(): void { this.viewDate = subMonths(this.viewDate, 1); this.refreshCalendarData(); }
  goToNextMonth(): void { this.viewDate = addMonths(this.viewDate, 1); this.refreshCalendarData(); }
  goToToday(): void {
    const today = new Date();
    if (this.viewDate.getMonth() === today.getMonth() && this.viewDate.getFullYear() === today.getFullYear()) { this.refreshCalendarData(); return; };
    this.viewDate = today; this.refreshCalendarData();
  }
}