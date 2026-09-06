import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarModule, CalendarView, CalendarEvent, DateAdapter } from 'angular-calendar';
import { Subscription, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { trigger, state, style, transition, animate } from '@angular/animations'; // Import animation functions
import { addMonths, subMonths, parseISO, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns';
import { getMonthView } from 'calendar-utils';
import { BudgetService, ExpenseCategory, IncomeSource, CalendarMetaData } from '../budget.service';

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [ CommonModule, CalendarModule, CurrencyPipe, FormsModule ],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('slideInOut', [
      state('in', style({ height: '*', opacity: 1, 'padding-top': '1.5rem', 'margin-top': '2.5rem' })), // Match original padding/margin
      transition('void => *', [ // ':enter'
        style({ height: 0, opacity: 0, 'padding-top': 0, 'margin-top': 0 }),
        animate('300ms ease-out')
      ]),
      transition('* => void', [ // ':leave'
        animate('300ms ease-in', style({ height: 0, opacity: 0, 'padding-top': 0, 'margin-top': 0 }))
      ])
    ])
  ]
})
export class CalendarComponent implements OnInit, OnDestroy {

  view: CalendarView = CalendarView.Month;
  CalendarView = CalendarView;
  viewDate: Date = new Date();
  events: CalendarEvent<CalendarMetaData>[] = [];
  receiptEventsThisMonth: CalendarEvent<CalendarMetaData>[] = [];
  allCategories: ExpenseCategory[] = [];
  allIncomes: IncomeSource[] = [];
  private dataSubscription!: Subscription;
  private currencySubscription!: Subscription;
  currencyCode = 'CAD';
  receiptTotalAmount = 0;

  currentSavings: number | null = null;
  projectionTargetDate = '';
  projectedSavings: number | null = null;
  isCalculatingProjection = false;
  showProjectionCalculator = false; // Flag to control visibility

  constructor(
    private budgetService: BudgetService,
    private cdr: ChangeDetectorRef,
    private dateAdapter: DateAdapter
  ) {}

  ngOnInit(): void {
    this.projectionTargetDate = this.getDefaultProjectionDate();
    this.dataSubscription = combineLatest([
      this.budgetService.categories$,
      this.budgetService.incomeSources$
    ]).pipe(
      map(([categories, incomeSources]) => {
        this.allCategories = categories;
        this.allIncomes = incomeSources;
        this.refreshCalendarData(categories, incomeSources);
      })
    ).subscribe(() => {
       this.cdr.markForCheck();
    });
    this.currencySubscription = this.budgetService.currency$.subscribe(code => { this.currencyCode = code; this.cdr.markForCheck(); });
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
    if (this.currencySubscription) { this.currencySubscription.unsubscribe(); }
  }

  getDefaultProjectionDate(): string {
    const today = new Date();
    const nextMonth = addMonths(today, 1);
    const targetDate = endOfMonth(nextMonth);
    const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
    const day = targetDate.getDate().toString().padStart(2, '0');
    return `${targetDate.getFullYear()}-${month}-${day}`;
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

  private refreshCalendarData(categories: ExpenseCategory[], incomeSources: IncomeSource[]): void {
    if (!categories || !incomeSources) {
        this.events = []; this.receiptEventsThisMonth = []; this.receiptTotalAmount = 0; return;
    };
    const viewPeriod = this.getViewPeriod();
    const currentViewMonth = this.viewDate.getMonth();
    const currentViewYear = this.viewDate.getFullYear();
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

  calculateProjection(): void {
    if (this.currentSavings === null || !this.projectionTargetDate) {
      alert('Please enter your current savings amount and a target date.'); return;
    }
    this.isCalculatingProjection = true;
    this.projectedSavings = null;
    try {
      const startDate = startOfDay(new Date());
      const targetDate = endOfDay(parseISO(this.projectionTargetDate));
      if (isNaN(targetDate.getTime()) || targetDate <= startDate) {
        alert('Please select a valid future date for the projection.'); this.isCalculatingProjection = false; return;
      }
      const projectionPeriod = { start: startDate, end: targetDate };
      const eventsInProjection = this.budgetService.getCalendarEventsForPeriod(this.allCategories, this.allIncomes, projectionPeriod);
      let netChange = 0;
      eventsInProjection.forEach(event => {
         const amount = event.meta?.data ? ('budget' in event.meta.data ? event.meta.data.budget : event.meta.data.amount) : 0;
         if(event.meta?.type === 'income') { netChange += (amount || 0); }
         else if (event.meta?.type === 'expense') { netChange -= (amount || 0); }
      });
      this.projectedSavings = this.currentSavings + netChange;
    } catch (error) { console.error("Error calculating projection:", error); alert("An error occurred while calculating the projection.");
    } finally { this.isCalculatingProjection = false; this.cdr.markForCheck(); }
  }

  getEventAmount(meta: CalendarMetaData | undefined): number {
    if (!meta?.data) { return 0; }
    if (meta.type === 'income') { return (meta.data as IncomeSource).amount; }
    else if (meta.type === 'expense') { return (meta.data as ExpenseCategory).budget; }
    return 0;
  }

  toggleProjectionCalculator(): void { // New toggle method
    this.showProjectionCalculator = !this.showProjectionCalculator;
    if (!this.showProjectionCalculator) {
      this.projectedSavings = null; // Reset result when hiding
    }
  }

  setView(view: CalendarView): void { this.view = view; this.refreshCalendarData(this.allCategories, this.allIncomes); }
  goToPreviousMonth(): void { this.viewDate = subMonths(this.viewDate, 1); this.refreshCalendarData(this.allCategories, this.allIncomes); }
  goToNextMonth(): void { this.viewDate = addMonths(this.viewDate, 1); this.refreshCalendarData(this.allCategories, this.allIncomes); }
  goToToday(): void {
    const today = new Date();
    if (this.viewDate.getMonth() === today.getMonth() && this.viewDate.getFullYear() === today.getFullYear()) { return; };
    this.viewDate = today; this.refreshCalendarData(this.allCategories, this.allIncomes);
  }
}