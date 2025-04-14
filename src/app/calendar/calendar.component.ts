import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { CalendarModule, CalendarView, CalendarEvent, DateAdapter } from 'angular-calendar';
import { Subscription, combineLatest, BehaviorSubject } from 'rxjs'; // Import BehaviorSubject, combineLatest
import { map } from 'rxjs/operators';
import {
  addMonths, subMonths, lastDayOfMonth, parseISO, addWeeks, addYears, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, isWithinInterval, addDays, getMonth, getYear, format, startOfDay, endOfDay
} from 'date-fns';
import { getMonthView } from 'calendar-utils';
import { BudgetService, ExpenseCategory, IncomeSource, CalendarMetaData } from '../budget.service';

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

  private viewDateSubject = new BehaviorSubject<Date>(new Date());
  viewDate$ = this.viewDateSubject.asObservable(); // Observable stream of the date

  events: CalendarEvent<CalendarMetaData>[] = [];
  receiptEventsThisMonth: CalendarEvent<CalendarMetaData>[] = [];
  private dataSubscription!: Subscription;
  receiptTotalAmount: number = 0;

  constructor(
    private budgetService: BudgetService,
    private cdr: ChangeDetectorRef,
    private dateAdapter: DateAdapter
  ) {}

  // Getter to easily access the current date value in template if needed
  get viewDate(): Date {
    return this.viewDateSubject.getValue();
  }

  ngOnInit(): void {
    this.dataSubscription = combineLatest([
      this.budgetService.categories$,
      this.budgetService.incomeSources$,
      this.viewDate$ // Combine with the date stream
    ]).pipe(
      map(([categories, incomeSources, viewDate]) => {
        this.refreshCalendarData(categories, incomeSources, viewDate); // Pass date explicitly
      })
    ).subscribe(() => {
       this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
  }

  private getViewPeriod(dateForView: Date): { viewStart: Date, viewEnd: Date } { // Accept date
     if (this.view === CalendarView.Month) {
        const view = getMonthView(this.dateAdapter, { events: [], viewDate: dateForView, weekStartsOn: 0 });
        return { viewStart: view.period.start, viewEnd: view.period.end };
     } else if (this.view === CalendarView.Week) {
        const viewStart = startOfWeek(dateForView); const viewEnd = endOfWeek(dateForView);
        return { viewStart, viewEnd };
     } else {
        return { viewStart: startOfDay(dateForView), viewEnd: endOfDay(dateForView) };
     }
  }

  private refreshCalendarData(categories: ExpenseCategory[], incomeSources: IncomeSource[], currentViewDate: Date): void { // Accept date
    if (!categories || !incomeSources) {
        this.events = []; this.receiptEventsThisMonth = []; this.receiptTotalAmount = 0; return;
    };

    const viewPeriod = this.getViewPeriod(currentViewDate); // Use passed-in date
    const currentViewMonth = currentViewDate.getMonth();
    const currentViewYear = currentViewDate.getFullYear();

    // Call service method - it needs the full lists
    this.events = this.budgetService.getCalendarEventsForPeriod(categories, incomeSources, { start: viewPeriod.viewStart, end: viewPeriod.viewEnd });

    this.receiptEventsThisMonth = this.events.filter(event => {
        try { return event.start.getMonth() === currentViewMonth && event.start.getFullYear() === currentViewYear; }
        catch { return false; }
    });

    this.receiptTotalAmount = this.receiptEventsThisMonth.reduce((sum, event) => {
        const amount = event.meta?.data ? ('budget' in event.meta.data ? event.meta.data.budget : event.meta.data.amount) : 0;
        if(event.meta?.type === 'income') { return sum + (amount || 0); }
        else if (event.meta?.type === 'expense') { return sum - (amount || 0); }
        return sum;
    }, 0);
  }

  setView(view: CalendarView): void {
      this.view = view;
      // Optional: Trigger refresh immediately if view change affects period differently
      // than just date change, otherwise combineLatest handles it via viewDate potentially
      // this.refreshCalendarData(this.budgetService.getCategoriesSnapshot(), this.budgetService.getIncomeSourcesSnapshot());
      // For now, let's assume changing viewDate (if needed) is enough
  }

  getEventAmount(meta: CalendarMetaData | undefined): number {
    if (!meta?.data) { return 0; }
    if (meta.type === 'income') {
        return (meta.data as IncomeSource).amount;
    } else if (meta.type === 'expense') {
        return (meta.data as ExpenseCategory).budget;
    }
    return 0;
  }

  // Navigation methods ONLY update the viewDateSubject
  goToPreviousMonth(): void {
    this.viewDateSubject.next(subMonths(this.viewDateSubject.getValue(), 1));
  }

  goToNextMonth(): void {
    this.viewDateSubject.next(addMonths(this.viewDateSubject.getValue(), 1));
  }

  goToToday(): void {
    const today = new Date();
    const current = this.viewDateSubject.getValue();
    // Avoid emitting if already on today's month/year in month view
    if (this.view === CalendarView.Month && current.getMonth() === today.getMonth() && current.getFullYear() === today.getFullYear()){
         return;
    }
    this.viewDateSubject.next(today);
  }
}