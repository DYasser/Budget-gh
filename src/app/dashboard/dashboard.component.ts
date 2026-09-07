import { Component, OnInit, OnDestroy, ViewChild, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { trigger, style, transition, animate, AnimationEvent } from '@angular/animations';
import { Router } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { BudgetService, ExpenseCategory, IncomeSource, MonthTotal } from '../budget.service';

/** The three rings the dashboard can show. */
export type DashboardView = 'balance' | 'income' | 'expenses';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [ CommonModule, BaseChartDirective, CurrencyPipe ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  animations: [
    trigger('fade', [
      transition('void => *', [ style({ opacity: 0 }), animate('500ms ease-in', style({ opacity: 1 })) ]),
      transition('* => void', [ animate('500ms ease-out', style({ opacity: 0 })) ])
    ])
  ]
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;

  showWelcome = true;
  showChart = false;
  viewDate: Date = new Date();
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private resizeTimeout: ReturnType<typeof setTimeout> | undefined;
  private categoriesSubscription!: Subscription;
  private boundResizeHandler: any;

  totalBudget = 0;
  totalIncome = 0;
  chartDateRangeTitle = '';
  currencyCode = 'CAD';
  mobileNavOpen = false;
  mobileNavClosing = false;
  private currencySubscription!: Subscription;

  /** Which ring is on screen. Balance leads because "what's left" is the headline. */
  activeView: DashboardView = 'balance';
  readonly views: { id: DashboardView; label: string }[] = [
    { id: 'balance', label: 'Balance' },
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
  ];

  private expenseTotals: MonthTotal[] = [];
  private incomeTotals: MonthTotal[] = [];

  /** Legend rows for the ring currently shown. */
  legendRows: { label: string; color: string; amount: number }[] = [];

  private readonly INCOME_COLOR = '#4BC0C0';
  private readonly EXPENSE_COLOR = '#FF6384';
  private readonly INCOME_PALETTE = ['#4BC0C0', '#36A2EB', '#7CFFC4', '#9966FF', '#BDB2FF'];
  private readonly EXPENSE_PALETTE = ['#FF6384', '#FF9F40', '#FFCD56', '#C9CBCF', '#FF7C7C'];

  public doughnutChartLabels: string[] = [];
  public doughnutChartDatasets: ChartConfiguration<'doughnut'>['data']['datasets'] = [
    { data: [], label: 'Budget Allocation', backgroundColor: [], hoverBackgroundColor: [], hoverBorderColor: '#fff', borderWidth: 1, hoverOffset: 4 }
  ];
  public doughnutChartType = 'doughnut' as const;
  public doughnutChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: true,
    cutout: '85%',
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      datalabels: { display: false }
    }
  };

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private budgetService: BudgetService
  ) {}

  ngOnInit(): void {
    this.setChartDateTitle();
    const alreadyWelcomed = sessionStorage.getItem('dashboardWelcomed');
    if (alreadyWelcomed === 'true') {
      this.showWelcome = false;
      setTimeout(() => { this.showChart = true; this.cdr.detectChanges(); this.attemptChartResize(); }, 0);
    } else {
      this.showWelcome = true; this.showChart = false;
      this.timerHandle = setTimeout(() => { if (this.showWelcome) { this.showWelcome = false; } }, 3000);
    }
    this.categoriesSubscription = combineLatest([
      this.budgetService.categories$,
      this.budgetService.incomeSources$
    ]).subscribe(([categories, incomeSources]) => {
      this.recalculateMonth(categories, incomeSources);
    });
    this.currencySubscription = this.budgetService.currency$.subscribe(code => { this.currencyCode = code; this.cdr.detectChanges(); });
    if (window.visualViewport) {
      this.boundResizeHandler = this.handleViewportResize.bind(this);
      window.visualViewport.addEventListener('resize', this.boundResizeHandler);
    }
  }

  ngOnDestroy(): void {
    if (this.timerHandle) { clearTimeout(this.timerHandle); }
    clearTimeout(this.resizeTimeout);
    if (this.categoriesSubscription) { this.categoriesSubscription.unsubscribe(); }
    if (this.currencySubscription) { this.currencySubscription.unsubscribe(); }
    if (this.boundResizeHandler && window.visualViewport) { window.visualViewport.removeEventListener('resize', this.boundResizeHandler); }
  }

  private getOrdinalSuffix(day: number): string {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; }
  }

  setChartDateTitle(): void {
      const now = new Date();
      const currentMonthName = now.toLocaleString('default', { month: 'long' });
      const currentYear = now.getFullYear(); const currentMonthIndex = now.getMonth();
      const lastDayOfMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
      const firstSuffix = this.getOrdinalSuffix(1); const lastSuffix = this.getOrdinalSuffix(lastDayOfMonth);
      this.chartDateRangeTitle = `${currentMonthName} 1<sup>${firstSuffix}</sup> - ${lastDayOfMonth}<sup>${lastSuffix}</sup>`;
  }

  /** Recompute the month from scratch, then redraw whichever ring is showing. */
  recalculateMonth(categories: ExpenseCategory[], incomeSources: IncomeSource[]): void {
    const targetDate = this.viewDate;

    // Both sides use occurrences-in-month, not monthly averages, so subtracting them
    // gives a figure that matches what the calendar shows for the same month.
    this.expenseTotals = this.budgetService.getExpenseTotalsForMonth(categories, targetDate);
    this.incomeTotals = this.budgetService.getIncomeTotalsForMonth(incomeSources, targetDate);
    this.totalBudget = this.budgetService.calculateTotalOccurrencesBudgetForMonth(categories, targetDate);
    this.totalIncome = this.budgetService.calculateTotalIncomeOccurrencesForMonth(incomeSources, targetDate);

    this.renderActiveView();
  }

  /** What is left after this month's charges. Negative when overspending. */
  get remaining(): number {
    return this.totalIncome - this.totalBudget;
  }

  /** The figure shown inside the ring. */
  get centreAmount(): number {
    switch (this.activeView) {
      case 'balance':  return this.remaining;
      case 'income':   return this.totalIncome;
      case 'expenses': return this.totalBudget;
    }
  }

  get centreCaption(): string {
    switch (this.activeView) {
      case 'balance':  return this.remaining < 0 ? 'over budget' : 'left this month';
      case 'income':   return 'coming in';
      case 'expenses': return 'going out';
    }
  }

  /** True when the month has nothing to draw for the current view. */
  get isEmpty(): boolean {
    switch (this.activeView) {
      case 'balance':  return this.totalIncome === 0 && this.totalBudget === 0;
      case 'income':   return this.incomeTotals.length === 0;
      case 'expenses': return this.expenseTotals.length === 0;
    }
  }

  get emptyMessage(): string {
    switch (this.activeView) {
      case 'balance':  return 'Add income and expenses to see what is left';
      case 'income':   return 'No income recorded for this month';
      case 'expenses': return 'No expenses due this month';
    }
  }

  selectView(view: DashboardView): void {
    if (view === this.activeView) { return; }
    this.activeView = view;
    this.renderActiveView();
  }

  private renderActiveView(): void {
    const segments = this.activeView === 'balance'
      ? this.buildBalanceSegments()
      : (this.activeView === 'income' ? this.incomeTotals : this.expenseTotals)
          .map((entry, index) => ({
            label: entry.name,
            amount: entry.total,
            color: entry.color || this.paletteColor(this.activeView, index),
          }));

    this.doughnutChartLabels = segments.map(seg => seg.label);
    const dataset = this.doughnutChartDatasets[0];
    if (dataset) {
      dataset.data = segments.map(seg => seg.amount);
      const colors = segments.map(seg => seg.color);
      dataset.backgroundColor = colors;
      dataset.hoverBackgroundColor = colors;
    }
    this.legendRows = segments;

    if (this.chart) { this.chart.update(); }
    this.cdr.detectChanges();
  }

  /**
   * Balance is two slices rather than a breakdown: what this month's charges consume,
   * and what survives them. Overspending has no remainder to show, so the ring becomes
   * a single spent slice and the centre figure carries the shortfall.
   */
  private buildBalanceSegments(): { label: string; amount: number; color: string }[] {
    const spent = { label: 'Spent', amount: this.totalBudget, color: this.EXPENSE_COLOR };
    if (this.remaining <= 0) { return [spent]; }
    return [spent, { label: 'Remaining', amount: this.remaining, color: this.INCOME_COLOR }];
  }

  private paletteColor(view: DashboardView, index: number): string {
    const palette = view === 'income' ? this.INCOME_PALETTE : this.EXPENSE_PALETTE;
    return palette[index % palette.length];
  }

  handleViewportResize(): void {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.attemptChartResize();
    }, 75);
  }

  attemptChartResize(): void {
    if (!this.chart?.chart) { return; }
    try {
        console.log('[RESIZE] Attempting resize/update...'); // Keep log
        this.chart.chart.resize();
        this.chart.chart.update('none');
        this.cdr.detectChanges();
        console.log('[RESIZE] Resize/update finished.'); // Keep log
    } catch (error) {
        console.error('[RESIZE] Error during chart resize/update:', error);
    }
  }

  onWelcomeFadeDone(event: AnimationEvent): void {
    if (event.toState === 'void' && !this.showChart) {
      setTimeout(() => { this.showChart = true; this.cdr.detectChanges(); this.attemptChartResize(); sessionStorage.setItem('dashboardWelcomed', 'true'); }, 0);
    }
  }

  toggleMobileNav(): void {
    if (this.mobileNavOpen) { this.closeMobileNav(); } else { this.mobileNavOpen = true; }
  }

  closeMobileNav(): void {
    if (!this.mobileNavOpen) { return; }
    this.mobileNavClosing = true;
    setTimeout(() => { this.mobileNavOpen = false; this.mobileNavClosing = false; this.cdr.detectChanges(); }, 300);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.mobileNavOpen) { this.closeMobileNav(); } }

  goTo(page: string): void { this.closeMobileNav(); const targetRoute = `/${page}`; this.router.navigate([targetRoute]); }
}