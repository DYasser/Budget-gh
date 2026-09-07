import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { parseISO, lastDayOfMonth, addMonths, addWeeks, addYears, format, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { CalendarEvent } from 'angular-calendar';

export type BudgetFrequency = 'Monthly' | 'Weekly' | 'Bi-Weekly' | 'Quarterly' | 'Annually' | 'One-Time';

export interface ExpenseCategory {
  id: string;
  name: string;
  budget: number;
  frequency: BudgetFrequency;
  dueDate: string;
  isDueEndOfMonth?: boolean;
  color?: string;
}

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  frequency: BudgetFrequency;
  receiveDate: string;
}

/** One line of a month breakdown: what a single category or source came to. */
export interface MonthTotal {
  id: string;
  name: string;
  total: number;
  color?: string;
}

export type CalendarMetaData = { type: 'expense', data: ExpenseCategory } | { type: 'income', data: IncomeSource };

@Injectable({
  providedIn: 'root'
})
export class BudgetService {

  private readonly EXPENSES_KEY = 'budget_io_expenses';
  private readonly INCOMES_KEY = 'budget_io_incomes';
  private readonly CURRENCY_KEY = 'budget_io_currency';

  private _categories$ = new BehaviorSubject<ExpenseCategory[]>(this.loadExpenses());
  private _incomeSources$ = new BehaviorSubject<IncomeSource[]>(this.loadIncomes());
  private _currency$ = new BehaviorSubject<string>(this.loadCurrency());

  categories$: Observable<ExpenseCategory[]> = this._categories$.asObservable();
  incomeSources$: Observable<IncomeSource[]> = this._incomeSources$.asObservable();
  currency$: Observable<string> = this._currency$.asObservable();

  /**
   * Categorical palette, assigned in fixed order and never cycled.
   *
   * Seven hues validated as a set for colour-vision deficiency and for
   * normal-vision separation between neighbouring segments; the previous five-hue
   * palette repeated itself from the sixth category onward, so a twelve-category
   * month drew Rent and Gas in the same pink. Anything past the last entry is
   * grouped under a neutral grey rather than given a made-up extra hue.
   *
   * Green is absent on purpose: it is reserved for REMAINING_COLOR below, so the
   * balance ring's "money you keep" can never be the same hue as a category.
   */
  private readonly categoricalPalette: readonly string[] = [
    '#2a78d6', // blue
    '#eb6834', // orange
    '#1baf7a', // aqua
    '#eda100', // yellow
    '#e87ba4', // magenta
    '#4a3aa7', // violet
  ];

  /** Used for the grouped remainder and for anything without a slot of its own. */
  readonly OTHER_COLOR = '#8b8b86';

  /**
   * The two slices of the dashboard's balance ring.
   *
   * Deliberately outside categoricalPalette. The balance ring encodes a quantity
   * (spent against remaining), not identity, so reusing a category hue would make
   * "money you keep" and "your third-largest expense" the same green when switching
   * views. Both clear 3:1 against a white surface, and the ring's labels supply the
   * secondary encoding the red/green pair needs for colour-vision deficiency.
   */
  readonly SPENT_COLOR = '#e34948';
  readonly REMAINING_COLOR = '#008300';

  /**
   * Where income starts in the shared palette.
   *
   * Expenses fill from the front, income from the middle, so the first of each does
   * not collide. Wrapping is handled by getColorByIndex.
   */
  private readonly INCOME_PALETTE_OFFSET = 3;

  /** How many entries get their own hue before the rest are grouped. */
  readonly MAX_DISTINCT_SERIES = this.categoricalPalette.length;
  private readonly WEEKS_IN_MONTH = 52 / 12;
  private readonly BIWEEKS_IN_MONTH = 26 / 12;
  /** Safety valve on rule expansion: ~19 years of weekly occurrences. */
  private readonly MAX_OCCURRENCES = 1000;

  private loadExpenses(): ExpenseCategory[] {
    try {
      const raw = localStorage.getItem(this.EXPENSES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private loadIncomes(): IncomeSource[] {
    try {
      const raw = localStorage.getItem(this.INCOMES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private saveExpenses(data: ExpenseCategory[]): void {
    localStorage.setItem(this.EXPENSES_KEY, JSON.stringify(data));
    this._categories$.next(data);
  }

  private saveIncomes(data: IncomeSource[]): void {
    localStorage.setItem(this.INCOMES_KEY, JSON.stringify(data));
    this._incomeSources$.next(data);
  }

  /**
   * Every date on which a recurrence rule falls inside [interval.start, interval.end].
   *
   * The single source of truth for when things are due: the calendar, the per-month
   * totals and any future consumer all expand a rule through here.
   *
   * Two details carry the month-length edge cases:
   *
   * - Each occurrence is derived from `startDate` plus N periods, never from the
   *   previous occurrence. A rule starting Jan 31 therefore yields Feb 28 and then
   *   Mar 31 - stepping occurrence-to-occurrence would clamp to 28 permanently.
   * - `isDueEndOfMonth` resolves against each target month in turn, so it tracks
   *   Feb 29 in a leap year and Feb 28 otherwise.
   *
   * Returns [] for a rule with no start date, an unparseable start date, or an
   * interval that ends before the rule begins.
   */
  private getOccurrences(
    rule: { frequency: BudgetFrequency; startDate: string; isDueEndOfMonth?: boolean },
    interval: { start: Date; end: Date }
  ): Date[] {
    if (!rule.startDate) { return []; }

    const startDate = parseISO(rule.startDate);
    if (isNaN(startDate.getTime())) { return []; }

    const isEndOfMonth = rule.frequency === 'Monthly' && !!rule.isDueEndOfMonth;
    const occurrences: Date[] = [];

    for (let period = 0; period < this.MAX_OCCURRENCES; period++) {
      const occurrence = this.occurrenceAt(startDate, rule.frequency, isEndOfMonth, period);

      // Series runs forward from startDate, so once past the window no later
      // occurrence can qualify - and nothing can precede startDate.
      if (occurrence > interval.end) { break; }
      if (occurrence >= interval.start) { occurrences.push(occurrence); }
      if (rule.frequency === 'One-Time') { break; }
    }

    return occurrences;
  }

  /** The date `period` recurrences after `startDate`, clamped to the target month's length. */
  private occurrenceAt(startDate: Date, frequency: BudgetFrequency, isEndOfMonth: boolean, period: number): Date {
    if (isEndOfMonth) { return lastDayOfMonth(addMonths(startDate, period)); }

    switch (frequency) {
      case 'One-Time':  return startDate;
      case 'Weekly':    return addWeeks(startDate, period);
      case 'Bi-Weekly': return addWeeks(startDate, period * 2);
      case 'Quarterly': return this.addMonthsClamped(startDate, period * 3);
      case 'Annually':  return addYears(startDate, period);
      case 'Monthly':   return this.addMonthsClamped(startDate, period);
    }
  }

  /**
   * Adds months while keeping the original day-of-month wherever the target month is
   * long enough - Jan 31 plus one month is Feb 28, but plus two is Mar 31.
   */
  private addMonthsClamped(startDate: Date, months: number): Date {
    const shifted = addMonths(startDate, months);
    const day = Math.min(startDate.getDate(), lastDayOfMonth(shifted).getDate());
    return new Date(shifted.getFullYear(), shifted.getMonth(), day);
  }

  /**
   * Categories whose cost is being carried during the target month.
   *
   * Drives the dashboard chart and the expenses proportion bars, both of which show a
   * monthly-equivalent view. A recurring category therefore counts from its start month
   * onward - a quarterly bill still costs a share of every month between charges - while
   * a One-Time charge belongs only to the month it falls in.
   */
  getRelevantCategoriesForMonth(categories: ExpenseCategory[], targetDate: Date): ExpenseCategory[] {
      const targetMonth = targetDate.getMonth(); const targetYear = targetDate.getFullYear();
      return categories.filter(cat => {
          if (!cat.dueDate) return false;
          try {
              const startDate = parseISO(cat.dueDate); if (isNaN(startDate.getTime())) throw new Error();
              const dueMonth = startDate.getMonth(); const dueYear = startDate.getFullYear();
              const hasStarted = (dueYear < targetYear) || (dueYear === targetYear && dueMonth <= targetMonth);
              if (cat.frequency === 'One-Time') { return dueYear === targetYear && dueMonth === targetMonth; }
              return hasStarted;
          } catch { return false; }
      });
  }

  /**
   * What each category actually charges during the target month, largest first, with
   * categories that charge nothing in the month left out.
   *
   * Feeds the dashboard's expense ring, so the segments sum to the ring's total rather
   * than to a monthly average - see calculateTotalOccurrencesBudgetForMonth.
   */
  getExpenseTotalsForMonth(categories: ExpenseCategory[], targetDate: Date): MonthTotal[] {
      const month = { start: startOfMonth(targetDate), end: endOfMonth(targetDate) };

      return categories
          .map(cat => ({
              id: cat.id,
              name: cat.name,
              color: cat.color,
              total: this.getOccurrences(
                { frequency: cat.frequency, startDate: cat.dueDate, isDueEndOfMonth: cat.isDueEndOfMonth },
                month
              ).length * cat.budget,
          }))
          .filter(entry => entry.total > 0)
          .sort((a, b) => b.total - a.total);
  }

  /** What each income source actually pays during the target month, largest first. */
  getIncomeTotalsForMonth(incomeSources: IncomeSource[], targetDate: Date): MonthTotal[] {
      const month = { start: startOfMonth(targetDate), end: endOfMonth(targetDate) };

      return incomeSources
          .map(source => ({
              id: source.id,
              name: source.name,
              total: this.getOccurrences(
                { frequency: source.frequency, startDate: source.receiveDate },
                month
              ).length * source.amount,
          }))
          .filter(entry => entry.total > 0)
          .sort((a, b) => b.total - a.total);
  }

  /**
   * What actually arrives during the target month. The income counterpart to
   * calculateTotalOccurrencesBudgetForMonth, so the two can be subtracted.
   */
  calculateTotalIncomeOccurrencesForMonth(incomeSources: IncomeSource[], targetDate: Date): number {
      return this.getIncomeTotalsForMonth(incomeSources, targetDate)
          .reduce((total, entry) => total + entry.total, 0);
  }

  /**
   * What one category costs per month on average, normalising every frequency to a
   * monthly figure. A One-Time charge has no ongoing cost and so contributes its full
   * amount only to the month it falls in, which getRelevantCategoriesForMonth decides.
   */
  getMonthlyEquivalent(category: ExpenseCategory): number {
      switch (category.frequency) {
          case 'Monthly':   return category.budget;
          case 'Weekly':    return category.budget * this.WEEKS_IN_MONTH;
          case 'Bi-Weekly': return category.budget * this.BIWEEKS_IN_MONTH;
          case 'Quarterly': return category.budget / 3;
          case 'Annually':  return category.budget / 12;
          case 'One-Time':  return category.budget;
      }
  }

  /** What the budget costs per month on average. See getMonthlyEquivalent. */
  calculateTotalMonthlyEquivalentBudget(categories: ExpenseCategory[], targetDate: Date): number {
      return this.getRelevantCategoriesForMonth(categories, targetDate)
          .reduce((total, cat) => total + this.getMonthlyEquivalent(cat), 0);
  }

  /**
   * What is actually charged during the target month.
   *
   * Distinct from calculateTotalMonthlyEquivalentBudget: a weekly $10 expense averages
   * $43.33 a month but costs $50 in a month holding five occurrences.
   */
  calculateTotalOccurrencesBudgetForMonth(categories: ExpenseCategory[], targetDate: Date): number {
      const month = { start: startOfMonth(targetDate), end: endOfMonth(targetDate) };

      return categories.reduce((total, cat) => {
          const occurrences = this.getOccurrences(
            { frequency: cat.frequency, startDate: cat.dueDate, isDueEndOfMonth: cat.isDueEndOfMonth },
            month
          );
          return total + occurrences.length * cat.budget;
      }, 0);
  }

  /** Expense and income occurrences in the period, as calendar events sorted by date. */
  getCalendarEventsForPeriod(categories: ExpenseCategory[], incomeSources: IncomeSource[], period: { start: Date, end: Date }): CalendarEvent<CalendarMetaData>[] {
    const periodInterval = { start: startOfDay(period.start), end: endOfDay(period.end) };

    const expenseEvents = categories.flatMap((category, catIndex) => {
        const occurrences = this.getOccurrences(
          { frequency: category.frequency, startDate: category.dueDate, isDueEndOfMonth: category.isDueEndOfMonth },
          periodInterval
        );
        const color = category.color || this.getColorByIndex(catIndex);

        return occurrences.map(occurrence => this.toEvent({
            idPrefix: 'exp',
            id: category.id,
            occurrence,
            title: `${category.name}: -$${category.budget.toFixed(0)}`,
            color,
            meta: { type: 'expense', data: category },
        }));
    });

    const incomeEvents = incomeSources.flatMap((income, incomeIndex) => {
        const occurrences = this.getOccurrences(
          { frequency: income.frequency, startDate: income.receiveDate },
          periodInterval
        );
        // Offset so an income source and an expense category never land on the
        // same hue: in the month grid the dot is the only cue, and the +/- lives
        // in the receipt list rather than the calendar cell.
        const color = this.getColorByIndex(incomeIndex + this.INCOME_PALETTE_OFFSET);

        return occurrences.map(occurrence => this.toEvent({
            idPrefix: 'inc',
            id: income.id,
            occurrence,
            title: `${income.name}: +$${income.amount.toFixed(0)}`,
            color,
            meta: { type: 'income', data: income },
        }));
    });

    return [...expenseEvents, ...incomeEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private toEvent(spec: {
    idPrefix: string; id: string; occurrence: Date; title: string; color: string; meta: CalendarMetaData;
  }): CalendarEvent<CalendarMetaData> {
    return {
      id: `${spec.idPrefix}_${spec.id}_${format(spec.occurrence, 'yyyyMMdd')}`,
      start: spec.occurrence,
      title: spec.title,
      color: { primary: spec.color, secondary: this.adjustColorOpacity(spec.color, 0.6) },
      allDay: true,
      // Colour carries identity, so direction needs its own channel: in the month
      // grid the dot is all you see, and the +/- is only in the receipt list.
      cssClass: spec.meta.type === 'income' ? 'cal-income' : 'cal-expense',
      meta: spec.meta,
    };
  }

  private adjustColorOpacity(color: string, opacity: number): string {
      if (color.startsWith('#') && color.length === 7) { const r = parseInt(color.slice(1, 3), 16); const g = parseInt(color.slice(3, 5), 16); const b = parseInt(color.slice(5, 7), 16); return `rgba(${r}, ${g}, ${b}, ${opacity})`; }
      return 'rgba(100, 100, 100, 0.3)';
  }

  async addCategory(name: string, budget: number, frequency: BudgetFrequency, dueDate: string, isDueEndOfMonth: boolean): Promise<void> {
    if (!name.trim() || budget === null || budget <= 0 || !dueDate) { throw new Error("Invalid data for adding category"); }
    const current = this.loadExpenses();
    current.push({ id: crypto.randomUUID(), name: name.trim(), budget, frequency, dueDate, isDueEndOfMonth });
    this.saveExpenses(current);
  }

  async updateCategory(updatedCategory: ExpenseCategory): Promise<void> {
    if (!updatedCategory.id || !updatedCategory.dueDate) { throw new Error("Cannot update category without ID or due date"); }
    const current = this.loadExpenses();
    const index = current.findIndex(c => c.id === updatedCategory.id);
    if (index === -1) { throw new Error("Category not found"); }
    current[index] = { ...updatedCategory };
    this.saveExpenses(current);
  }

  async deleteCategory(id: string): Promise<void> {
    if (!id) { throw new Error("Cannot delete category without ID"); }
    const current = this.loadExpenses();
    this.saveExpenses(current.filter(c => c.id !== id));
  }

  async addIncomeSource(name: string, amount: number, frequency: BudgetFrequency, receiveDate: string): Promise<void> {
    if (!name.trim() || amount === null || amount <= 0 || !receiveDate) { throw new Error("Invalid data for adding income source"); }
    const current = this.loadIncomes();
    current.push({ id: crypto.randomUUID(), name: name.trim(), amount, frequency, receiveDate });
    this.saveIncomes(current);
  }

  async updateIncomeSource(updatedIncomeSource: IncomeSource): Promise<void> {
    if (!updatedIncomeSource.id || !updatedIncomeSource.receiveDate) { throw new Error("Cannot update income source without ID or receive date"); }
    const current = this.loadIncomes();
    const index = current.findIndex(i => i.id === updatedIncomeSource.id);
    if (index === -1) { throw new Error("Income source not found"); }
    current[index] = { ...updatedIncomeSource };
    this.saveIncomes(current);
  }

  async deleteIncomeSource(id: string): Promise<void> {
    if (!id) { throw new Error("Cannot delete income source without ID"); }
    const current = this.loadIncomes();
    this.saveIncomes(current.filter(i => i.id !== id));
  }

  /**
   * The hue for the nth entry. Past the palette's length this returns the neutral
   * grey rather than wrapping around to a colour already in use.
   */
  public getColorByIndex(index: number): string {
      return this.categoricalPalette[index] ?? this.OTHER_COLOR;
  }

  getCategoriesSnapshot(): ExpenseCategory[] {
    return [...this.loadExpenses()];
  }

  getIncomeSourcesSnapshot(): IncomeSource[] {
    return [...this.loadIncomes()];
  }

  private loadCurrency(): string {
    return localStorage.getItem(this.CURRENCY_KEY) ?? 'CAD';
  }

  getCurrencySnapshot(): string {
    return this._currency$.getValue();
  }

  setCurrency(code: string): void {
    localStorage.setItem(this.CURRENCY_KEY, code);
    this._currency$.next(code);
  }

  replaceExpenses(data: ExpenseCategory[]): void {
    this.saveExpenses(data);
  }

  replaceIncomes(data: IncomeSource[]): void {
    this.saveIncomes(data);
  }
}
