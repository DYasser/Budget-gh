import { TestBed } from '@angular/core/testing';
import { BudgetService, ExpenseCategory, IncomeSource } from './budget.service';

/**
 * Tests for the recurrence engine.
 *
 * The service answers two different questions that are easy to conflate:
 *
 *   calculateTotalMonthlyEquivalentBudget  - "what does this budget cost per month, on average?"
 *   calculateTotalOccurrencesBudgetForMonth - "what is actually due during this specific month?"
 *
 * These legitimately disagree. A weekly $10 expense averages $43.33/month (52/12 weeks)
 * but costs $50 in a month that happens to contain five occurrences. Tests below assert
 * both answers deliberately.
 *
 * Dates use local-midnight construction (`new Date(y, m, d)`) to match parseISO's handling
 * of date-only strings, so these tests are timezone-independent.
 */

/** Minimal in-memory localStorage stand-in so the service is testable in isolation. */
class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

describe('BudgetService', () => {
  let service: BudgetService;
  let storage: FakeStorage;

  /** Builds an expense category; only the fields a given test cares about need to be passed. */
  function expense(overrides: Partial<ExpenseCategory> & Pick<ExpenseCategory, 'frequency' | 'dueDate'>): ExpenseCategory {
    return {
      id: overrides.id ?? `exp-${overrides.frequency}-${overrides.dueDate}`,
      name: overrides.name ?? 'Test expense',
      budget: overrides.budget ?? 100,
      ...overrides,
    };
  }

  function income(overrides: Partial<IncomeSource> & Pick<IncomeSource, 'frequency' | 'receiveDate'>): IncomeSource {
    return {
      id: overrides.id ?? `inc-${overrides.frequency}-${overrides.receiveDate}`,
      name: overrides.name ?? 'Test income',
      amount: overrides.amount ?? 1000,
      ...overrides,
    };
  }

  /** Local midnight, matching how parseISO reads a date-only string. */
  const at = (year: number, month1Based: number, day: number) => new Date(year, month1Based - 1, day);

  /** Occurrence dates the calendar generated, as yyyy-mm-dd, for easier assertions. */
  function occurrenceDates(events: { start: Date }[]): string[] {
    return events.map(e => {
      const m = `${e.start.getMonth() + 1}`.padStart(2, '0');
      const d = `${e.start.getDate()}`.padStart(2, '0');
      return `${e.start.getFullYear()}-${m}-${d}`;
    });
  }

  beforeEach(() => {
    storage = new FakeStorage();
    spyOn(localStorage, 'getItem').and.callFake((k: string) => storage.getItem(k));
    spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => storage.setItem(k, v));
    spyOn(localStorage, 'removeItem').and.callFake((k: string) => storage.removeItem(k));

    TestBed.configureTestingModule({});
    service = TestBed.inject(BudgetService);
  });

  it('is created', () => {
    expect(service).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Month-length edge cases: the reason this engine is not trivial.
  // ---------------------------------------------------------------------------

  describe('monthly recurrence across months of differing length', () => {
    it('clamps a day-31 rule into February without losing the occurrence', () => {
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-01-31', budget: 1500 });

      const events = service.getCalendarEventsForPeriod([rent], [], {
        start: at(2025, 2, 1),
        end: at(2025, 2, 28),
      });

      expect(occurrenceDates(events)).toEqual(['2025-02-28']);
    });

    it('snaps back to day 31 in March rather than staying clamped at 28', () => {
      // Each occurrence is derived from the original start date, not from the previous
      // occurrence, so February's clamp does not permanently shorten the series.
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-01-31', budget: 1500 });

      const events = service.getCalendarEventsForPeriod([rent], [], {
        start: at(2025, 1, 1),
        end: at(2025, 4, 30),
      });

      expect(occurrenceDates(events)).toEqual(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
    });

    it('resolves an end-of-month rule to Feb 29 in a leap year', () => {
      const eom = expense({ frequency: 'Monthly', dueDate: '2024-01-15', isDueEndOfMonth: true });

      const events = service.getCalendarEventsForPeriod([eom], [], {
        start: at(2024, 2, 1),
        end: at(2024, 2, 29),
      });

      expect(occurrenceDates(events)).toEqual(['2024-02-29']);
    });

    it('resolves an end-of-month rule to Feb 28 in a non-leap year', () => {
      const eom = expense({ frequency: 'Monthly', dueDate: '2025-01-15', isDueEndOfMonth: true });

      const events = service.getCalendarEventsForPeriod([eom], [], {
        start: at(2025, 2, 1),
        end: at(2025, 2, 28),
      });

      expect(occurrenceDates(events)).toEqual(['2025-02-28']);
    });

    it('tracks each month\'s own last day across a full quarter', () => {
      const eom = expense({ frequency: 'Monthly', dueDate: '2025-01-10', isDueEndOfMonth: true });

      const events = service.getCalendarEventsForPeriod([eom], [], {
        start: at(2025, 1, 1),
        end: at(2025, 4, 30),
      });

      expect(occurrenceDates(events)).toEqual(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
    });
  });

  // ---------------------------------------------------------------------------
  // Occurrence totals for a specific month.
  // ---------------------------------------------------------------------------

  describe('calculateTotalOccurrencesBudgetForMonth', () => {
    it('counts every weekly occurrence, including a fifth one', () => {
      // January 2025 starts on a Wednesday, so a Wednesday weekly rule lands five times.
      const weekly = expense({ frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([weekly], at(2025, 1, 15))).toBe(50);
    });

    it('counts bi-weekly occurrences that straddle a month boundary', () => {
      const biweekly = expense({ frequency: 'Bi-Weekly', dueDate: '2025-01-01', budget: 10 });

      // Series runs Jan 1, 15, 29, Feb 12, 26, Mar 12, 26 - two land in March.
      expect(service.calculateTotalOccurrencesBudgetForMonth([biweekly], at(2025, 3, 15))).toBe(20);
    });

    it('still finds weekly occurrences late in the year, well past the start date', () => {
      // Guards the iteration cap: December is ~50 iterations from a January start.
      const weekly = expense({ frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([weekly], at(2025, 12, 15))).toBe(50);
    });

    it('counts a one-time expense only in the month it falls', () => {
      const oneTime = expense({ frequency: 'One-Time', dueDate: '2025-03-10', budget: 500 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([oneTime], at(2025, 3, 15))).toBe(500);
      expect(service.calculateTotalOccurrencesBudgetForMonth([oneTime], at(2025, 4, 15))).toBe(0);
    });

    it('projects a quarterly expense into future quarters', () => {
      const quarterly = expense({ frequency: 'Quarterly', dueDate: '2025-01-15', budget: 300 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([quarterly], at(2025, 7, 15))).toBe(300);
      expect(service.calculateTotalOccurrencesBudgetForMonth([quarterly], at(2025, 8, 15))).toBe(0);
    });

    it('projects an annual expense into later years', () => {
      const annual = expense({ frequency: 'Annually', dueDate: '2023-06-01', budget: 1200 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([annual], at(2025, 6, 15))).toBe(1200);
      expect(service.calculateTotalOccurrencesBudgetForMonth([annual], at(2025, 7, 15))).toBe(0);
    });

    it('ignores months before the start date', () => {
      const future = expense({ frequency: 'Monthly', dueDate: '2025-06-01', budget: 100 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([future], at(2025, 1, 15))).toBe(0);
    });

    it('sums across multiple categories', () => {
      const rent = expense({ id: 'rent', frequency: 'Monthly', dueDate: '2025-01-01', budget: 1500 });
      const coffee = expense({ id: 'coffee', frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });

      expect(service.calculateTotalOccurrencesBudgetForMonth([rent, coffee], at(2025, 1, 15))).toBe(1550);
    });

    it('returns zero for an empty budget', () => {
      expect(service.calculateTotalOccurrencesBudgetForMonth([], at(2025, 1, 15))).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Income and balance for a specific month.
  // ---------------------------------------------------------------------------

  describe('calculateTotalIncomeOccurrencesForMonth', () => {
    it('counts every payday in the month, including a fifth one', () => {
      // A Wednesday weekly income lands five times in January 2025.
      const wage = income({ frequency: 'Weekly', receiveDate: '2025-01-01', amount: 500 });

      expect(service.calculateTotalIncomeOccurrencesForMonth([wage], at(2025, 1, 15))).toBe(2500);
    });

    it('counts bi-weekly paydays that straddle a month boundary', () => {
      const wage = income({ frequency: 'Bi-Weekly', receiveDate: '2025-01-03', amount: 2000 });

      // Jan 3, 17, 31, then Feb 14 and 28 - two land in February.
      expect(service.calculateTotalIncomeOccurrencesForMonth([wage], at(2025, 2, 15))).toBe(4000);
    });

    it('ignores income that has not started yet', () => {
      const future = income({ frequency: 'Monthly', receiveDate: '2025-06-01', amount: 3000 });

      expect(service.calculateTotalIncomeOccurrencesForMonth([future], at(2025, 1, 15))).toBe(0);
    });

    it('counts a one-off payment only in its own month', () => {
      const bonus = income({ frequency: 'One-Time', receiveDate: '2025-03-10', amount: 5000 });

      expect(service.calculateTotalIncomeOccurrencesForMonth([bonus], at(2025, 3, 15))).toBe(5000);
      expect(service.calculateTotalIncomeOccurrencesForMonth([bonus], at(2025, 4, 15))).toBe(0);
    });

    it('sums across multiple sources', () => {
      const salary = income({ id: 'salary', frequency: 'Monthly', receiveDate: '2025-01-01', amount: 3000 });
      const freelance = income({ id: 'freelance', frequency: 'Monthly', receiveDate: '2025-01-20', amount: 800 });

      expect(service.calculateTotalIncomeOccurrencesForMonth([salary, freelance], at(2025, 1, 15))).toBe(3800);
    });

    it('returns zero with no income sources', () => {
      expect(service.calculateTotalIncomeOccurrencesForMonth([], at(2025, 1, 15))).toBe(0);
    });
  });

  describe('income and expenses together', () => {
    it('subtract cleanly because both count occurrences in the month', () => {
      // Both sides answer "what actually happens this month", so the difference is
      // meaningful. January 2025 holds five Wednesdays, so coffee costs $50, not $43.33.
      const salary = income({ frequency: 'Monthly', receiveDate: '2025-01-01', amount: 3000 });
      const rent = expense({ id: 'rent', frequency: 'Monthly', dueDate: '2025-01-01', budget: 1500 });
      const coffee = expense({ id: 'coffee', frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });

      const earned = service.calculateTotalIncomeOccurrencesForMonth([salary], at(2025, 1, 15));
      const spent = service.calculateTotalOccurrencesBudgetForMonth([rent, coffee], at(2025, 1, 15));

      expect(earned).toBe(3000);
      expect(spent).toBe(1550);
      expect(earned - spent).toBe(1450);
    });

    it('goes negative when the month costs more than it pays', () => {
      const salary = income({ frequency: 'Monthly', receiveDate: '2025-01-01', amount: 1000 });
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-01-01', budget: 1550 });

      const earned = service.calculateTotalIncomeOccurrencesForMonth([salary], at(2025, 1, 15));
      const spent = service.calculateTotalOccurrencesBudgetForMonth([rent], at(2025, 1, 15));

      expect(earned - spent).toBe(-550);
    });
  });

  describe('per-source income totals', () => {
    it('reports what each source pays in the month, dropping those that pay nothing', () => {
      const salary = income({ id: 'salary', name: 'Salary', frequency: 'Monthly', receiveDate: '2025-01-01', amount: 3000 });
      const weekly = income({ id: 'tips', name: 'Tips', frequency: 'Weekly', receiveDate: '2025-01-01', amount: 100 });
      const future = income({ id: 'raise', name: 'New job', frequency: 'Monthly', receiveDate: '2025-09-01', amount: 4000 });

      const breakdown = service.getIncomeTotalsForMonth([salary, weekly, future], at(2025, 1, 15));

      expect(breakdown.map(b => b.name)).toEqual(['Salary', 'Tips']);
      expect(breakdown.map(b => b.total)).toEqual([3000, 500]);
    });
  });

  describe('per-category expense totals', () => {
    it('reports what each category charges in the month, dropping those that charge nothing', () => {
      const rent = expense({ id: 'rent', name: 'Rent', frequency: 'Monthly', dueDate: '2025-01-01', budget: 1500 });
      const coffee = expense({ id: 'coffee', name: 'Coffee', frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });
      const future = expense({ id: 'gym', name: 'Gym', frequency: 'Monthly', dueDate: '2025-09-01', budget: 40 });

      const breakdown = service.getExpenseTotalsForMonth([rent, coffee, future], at(2025, 1, 15));

      expect(breakdown.map(b => b.name)).toEqual(['Rent', 'Coffee']);
      expect(breakdown.map(b => b.total)).toEqual([1500, 50]);
    });

    it('agrees with the month total it is derived from', () => {
      const rent = expense({ id: 'rent', name: 'Rent', frequency: 'Monthly', dueDate: '2025-01-01', budget: 1500 });
      const coffee = expense({ id: 'coffee', name: 'Coffee', frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });

      const breakdown = service.getExpenseTotalsForMonth([rent, coffee], at(2025, 1, 15));
      const summed = breakdown.reduce((t, b) => t + b.total, 0);

      expect(summed).toBe(service.calculateTotalOccurrencesBudgetForMonth([rent, coffee], at(2025, 1, 15)));
    });
  });

  // ---------------------------------------------------------------------------
  // Monthly-equivalent averaging.
  // ---------------------------------------------------------------------------

  describe('getMonthlyEquivalent', () => {
    it('normalises each frequency to a monthly figure', () => {
      const per = (frequency: ExpenseCategory['frequency'], budget: number) =>
        service.getMonthlyEquivalent(expense({ frequency, dueDate: '2025-01-01', budget }));

      expect(per('Monthly', 1500)).toBe(1500);
      expect(per('Weekly', 10)).toBeCloseTo(43.33, 2);      // 52/12 weeks a month
      expect(per('Bi-Weekly', 100)).toBeCloseTo(216.67, 2); // 26/12 periods a month
      expect(per('Quarterly', 300)).toBe(100);
      expect(per('Annually', 1200)).toBe(100);
      expect(per('One-Time', 500)).toBe(500);
    });
  });

  describe('calculateTotalMonthlyEquivalentBudget', () => {
    it('averages a weekly expense over 52/12 weeks rather than counting occurrences', () => {
      const weekly = expense({ frequency: 'Weekly', dueDate: '2025-01-01', budget: 10 });

      // Deliberately differs from the occurrence total of $50 for the same month:
      // this answers "what does it cost per month on average", not "what is due in January".
      expect(service.calculateTotalMonthlyEquivalentBudget([weekly], at(2025, 1, 15)))
        .toBeCloseTo(43.33, 2);
    });

    it('averages a bi-weekly expense over 26/12 periods', () => {
      const biweekly = expense({ frequency: 'Bi-Weekly', dueDate: '2025-01-01', budget: 100 });

      expect(service.calculateTotalMonthlyEquivalentBudget([biweekly], at(2025, 1, 15)))
        .toBeCloseTo(216.67, 2);
    });

    it('passes a monthly expense through unchanged', () => {
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-01-01', budget: 1500 });

      expect(service.calculateTotalMonthlyEquivalentBudget([rent], at(2025, 1, 15))).toBe(1500);
    });

    it('spreads a quarterly expense across three months', () => {
      const quarterly = expense({ frequency: 'Quarterly', dueDate: '2025-01-15', budget: 300 });

      expect(service.calculateTotalMonthlyEquivalentBudget([quarterly], at(2025, 1, 15))).toBe(100);
    });

    it('spreads an annual expense across twelve months', () => {
      const annual = expense({ frequency: 'Annually', dueDate: '2025-06-01', budget: 1200 });

      expect(service.calculateTotalMonthlyEquivalentBudget([annual], at(2025, 6, 15))).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Which categories count toward a given month.
  //
  // Both callers (the dashboard doughnut chart and the expenses proportion bars) use
  // this list to show what a month costs on average, so a category is relevant when it
  // has started by that month - and, for One-Time, when it actually falls in it.
  // ---------------------------------------------------------------------------

  describe('getRelevantCategoriesForMonth', () => {
    it('includes a monthly expense whose start month has passed', () => {
      const rent = expense({ frequency: 'Monthly', dueDate: '2024-05-01' });

      expect(service.getRelevantCategoriesForMonth([rent], at(2025, 1, 15)).length).toBe(1);
    });

    it('includes an end-of-month expense from its start month onward', () => {
      const eom = expense({ frequency: 'Monthly', dueDate: '2025-03-01', isDueEndOfMonth: true });

      expect(service.getRelevantCategoriesForMonth([eom], at(2025, 3, 15)).length).toBe(1);
      expect(service.getRelevantCategoriesForMonth([eom], at(2025, 8, 15)).length).toBe(1);
    });

    it('excludes an end-of-month expense before its start month', () => {
      const eom = expense({ frequency: 'Monthly', dueDate: '2025-06-01', isDueEndOfMonth: true });

      expect(service.getRelevantCategoriesForMonth([eom], at(2025, 1, 15)).length).toBe(0);
    });

    it('excludes an expense with no due date', () => {
      const noDate = expense({ frequency: 'Monthly', dueDate: '' });

      expect(service.getRelevantCategoriesForMonth([noDate], at(2025, 1, 15)).length).toBe(0);
    });

    it('excludes an expense whose due date does not parse', () => {
      const bad = expense({ frequency: 'Monthly', dueDate: 'not-a-date' });

      expect(service.getRelevantCategoriesForMonth([bad], at(2025, 1, 15)).length).toBe(0);
    });

    it('keeps a quarterly expense relevant in every month after it starts', () => {
      // A $300 quarterly bill costs $100/month year-round, not only in the month it is
      // charged, so it must stay on the chart between charges.
      const quarterly = expense({ frequency: 'Quarterly', dueDate: '2025-01-15', budget: 300 });

      expect(service.getRelevantCategoriesForMonth([quarterly], at(2025, 1, 15)).length).toBe(1);
      expect(service.getRelevantCategoriesForMonth([quarterly], at(2025, 2, 15)).length).toBe(1);
      expect(service.calculateTotalMonthlyEquivalentBudget([quarterly], at(2025, 2, 15))).toBe(100);
    });

    it('keeps an annual expense relevant in later years', () => {
      const annual = expense({ frequency: 'Annually', dueDate: '2023-06-01', budget: 1200 });

      expect(service.getRelevantCategoriesForMonth([annual], at(2025, 6, 15)).length).toBe(1);
      expect(service.getRelevantCategoriesForMonth([annual], at(2025, 11, 15)).length).toBe(1);
      expect(service.calculateTotalMonthlyEquivalentBudget([annual], at(2025, 11, 15))).toBe(100);
    });

    it('excludes a future-dated monthly expense from the current month', () => {
      const future = expense({ frequency: 'Monthly', dueDate: '2025-06-01', budget: 100 });

      expect(service.getRelevantCategoriesForMonth([future], at(2025, 1, 15)).length).toBe(0);
      expect(service.calculateTotalMonthlyEquivalentBudget([future], at(2025, 1, 15))).toBe(0);
      // ...and agrees with the occurrence total, which already reported nothing due.
      expect(service.calculateTotalOccurrencesBudgetForMonth([future], at(2025, 1, 15))).toBe(0);
    });

    it('includes a monthly expense from its own start month onward', () => {
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-06-15', budget: 100 });

      expect(service.getRelevantCategoriesForMonth([rent], at(2025, 6, 1)).length).toBe(1);
      expect(service.getRelevantCategoriesForMonth([rent], at(2025, 7, 1)).length).toBe(1);
    });

    it('excludes a future-dated weekly expense from the current month', () => {
      const future = expense({ frequency: 'Weekly', dueDate: '2026-01-01', budget: 10 });

      expect(service.getRelevantCategoriesForMonth([future], at(2025, 1, 15)).length).toBe(0);
    });

    it('includes a weekly expense once it has started', () => {
      const weekly = expense({ frequency: 'Weekly', dueDate: '2025-01-08', budget: 10 });

      expect(service.getRelevantCategoriesForMonth([weekly], at(2025, 1, 15)).length).toBe(1);
      expect(service.getRelevantCategoriesForMonth([weekly], at(2026, 5, 15)).length).toBe(1);
    });

    it('counts a one-time expense only in the month it falls', () => {
      // Unlike the recurring frequencies, a One-Time charge is not an ongoing cost:
      // it belongs to its own month and no other.
      const oneTime = expense({ frequency: 'One-Time', dueDate: '2025-03-10', budget: 500 });

      expect(service.getRelevantCategoriesForMonth([oneTime], at(2025, 3, 15)).length).toBe(1);
      expect(service.getRelevantCategoriesForMonth([oneTime], at(2025, 4, 15)).length).toBe(0);
      expect(service.getRelevantCategoriesForMonth([oneTime], at(2025, 2, 15)).length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Calendar event generation.
  // ---------------------------------------------------------------------------

  describe('getCalendarEventsForPeriod', () => {
    it('generates no events for an empty budget', () => {
      const events = service.getCalendarEventsForPeriod([], [], { start: at(2025, 1, 1), end: at(2025, 1, 31) });

      expect(events).toEqual([]);
    });

    it('returns expense and income events sorted by date', () => {
      const rent = expense({ id: 'rent', name: 'Rent', frequency: 'Monthly', dueDate: '2025-01-05', budget: 1500 });
      const salary = income({ id: 'salary', name: 'Salary', frequency: 'Monthly', receiveDate: '2025-01-01', amount: 3000 });

      const events = service.getCalendarEventsForPeriod([rent], [salary], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(occurrenceDates(events)).toEqual(['2025-01-01', '2025-01-05']);
      expect(events[0].meta?.type).toBe('income');
      expect(events[1].meta?.type).toBe('expense');
    });

    it('signs expense titles negative and income titles positive', () => {
      const rent = expense({ name: 'Rent', frequency: 'Monthly', dueDate: '2025-01-05', budget: 1500 });
      const salary = income({ name: 'Salary', frequency: 'Monthly', receiveDate: '2025-01-01', amount: 3000 });

      const events = service.getCalendarEventsForPeriod([rent], [salary], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(events[0].title).toBe('Salary: +$3000');
      expect(events[1].title).toBe('Rent: -$1500');
    });

    it('excludes occurrences that fall before the start date', () => {
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-03-01', budget: 1500 });

      const events = service.getCalendarEventsForPeriod([rent], [], {
        start: at(2025, 1, 1),
        end: at(2025, 2, 28),
      });

      expect(events).toEqual([]);
    });

    it('emits a one-time expense once and never repeats it', () => {
      const oneTime = expense({ frequency: 'One-Time', dueDate: '2025-03-10', budget: 500 });

      const events = service.getCalendarEventsForPeriod([oneTime], [], {
        start: at(2025, 1, 1),
        end: at(2025, 12, 31),
      });

      expect(occurrenceDates(events)).toEqual(['2025-03-10']);
    });

    it('carries the source category through on event metadata', () => {
      const rent = expense({ id: 'rent-id', name: 'Rent', frequency: 'Monthly', dueDate: '2025-01-05' });

      const [event] = service.getCalendarEventsForPeriod([rent], [], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(event.meta).toEqual({ type: 'expense', data: rent });
    });

    it('prefers a category\'s explicit colour over the default palette', () => {
      const rent = expense({ frequency: 'Monthly', dueDate: '2025-01-05', color: '#123456' });

      const [event] = service.getCalendarEventsForPeriod([rent], [], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(event.color?.primary).toBe('#123456');
      expect(event.color?.secondary).toBe('rgba(18, 52, 86, 0.6)');
    });

    it('skips entries with unparseable dates instead of throwing', () => {
      const bad = expense({ frequency: 'Monthly', dueDate: 'not-a-date' });
      const good = expense({ id: 'good', frequency: 'Monthly', dueDate: '2025-01-05' });

      const events = service.getCalendarEventsForPeriod([bad, good], [], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(occurrenceDates(events)).toEqual(['2025-01-05']);
    });

    it('generates recurring income on the same rules as expenses', () => {
      const salary = income({ frequency: 'Bi-Weekly', receiveDate: '2025-01-03', amount: 2000 });

      const events = service.getCalendarEventsForPeriod([], [salary], {
        start: at(2025, 1, 1),
        end: at(2025, 2, 28),
      });

      expect(occurrenceDates(events)).toEqual(['2025-01-03', '2025-01-17', '2025-01-31', '2025-02-14', '2025-02-28']);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence and CRUD.
  // ---------------------------------------------------------------------------

  describe('getColorByIndex', () => {
    it('gives each of the first seven entries a distinct colour', () => {
      const colors = Array.from({ length: service.MAX_DISTINCT_SERIES }, (_, i) => service.getColorByIndex(i));

      expect(new Set(colors).size).toBe(service.MAX_DISTINCT_SERIES);
    });

    it('never wraps back onto a colour already in use', () => {
      // The old palette repeated from the sixth category on, so a twelve-category
      // month drew two segments in the same pink.
      const named = Array.from({ length: service.MAX_DISTINCT_SERIES }, (_, i) => service.getColorByIndex(i));

      expect(named).not.toContain(service.OTHER_COLOR);
      expect(service.getColorByIndex(service.MAX_DISTINCT_SERIES)).toBe(service.OTHER_COLOR);
      expect(service.getColorByIndex(99)).toBe(service.OTHER_COLOR);
    });

    it('gives calendar expenses colours from the palette in order', () => {
      const first = expense({ id: 'a', frequency: 'Monthly', dueDate: '2025-01-05' });
      const second = expense({ id: 'b', frequency: 'Monthly', dueDate: '2025-01-06' });

      const events = service.getCalendarEventsForPeriod([first, second], [], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(events[0].color?.primary).toBe(service.getColorByIndex(0));
      expect(events[1].color?.primary).toBe(service.getColorByIndex(1));
    });

    it('does not paint the first income the same colour as the first expense', () => {
      // In the month grid the dot is the only cue - the +/- is in the receipt list -
      // so a paycheck and a bill sharing a hue makes them indistinguishable.
      const rent = expense({ id: 'rent', frequency: 'Monthly', dueDate: '2025-01-05' });
      const salary = income({ id: 'salary', frequency: 'Monthly', receiveDate: '2025-01-06' });

      const events = service.getCalendarEventsForPeriod([rent], [salary], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      const colors = events.map(e => e.color?.primary);
      expect(new Set(colors).size).toBe(2);
    });

    it('marks calendar events with their direction, independent of colour', () => {
      const rent = expense({ id: 'rent', frequency: 'Monthly', dueDate: '2025-01-05' });
      const salary = income({ id: 'salary', frequency: 'Monthly', receiveDate: '2025-01-06' });

      const events = service.getCalendarEventsForPeriod([rent], [salary], {
        start: at(2025, 1, 1),
        end: at(2025, 1, 31),
      });

      expect(events.find(e => e.meta?.type === 'expense')?.cssClass).toBe('cal-expense');
      expect(events.find(e => e.meta?.type === 'income')?.cssClass).toBe('cal-income');
    });

    it('keeps the balance colours out of the categorical palette', () => {
      // Otherwise switching Balance -> Expenses turns "money you keep" into
      // "your nth-largest expense" in the same green.
      const categorical = Array.from(
        { length: service.MAX_DISTINCT_SERIES },
        (_, i) => service.getColorByIndex(i),
      );

      expect(categorical).not.toContain(service.REMAINING_COLOR);
      expect(categorical).not.toContain(service.SPENT_COLOR);
    });
  });

  describe('expense persistence', () => {
    it('adds a category and pushes it to subscribers', async () => {
      const emitted: ExpenseCategory[][] = [];
      service.categories$.subscribe(c => emitted.push(c));

      await service.addCategory('Rent', 1500, 'Monthly', '2025-01-01', false);

      expect(service.getCategoriesSnapshot().length).toBe(1);
      expect(service.getCategoriesSnapshot()[0].name).toBe('Rent');
      expect(emitted.length).toBe(2); // initial empty state, then the addition
    });

    it('trims whitespace from a category name', async () => {
      await service.addCategory('  Rent  ', 1500, 'Monthly', '2025-01-01', false);

      expect(service.getCategoriesSnapshot()[0].name).toBe('Rent');
    });

    it('survives a round trip through storage', async () => {
      await service.addCategory('Rent', 1500, 'Monthly', '2025-01-01', false);

      expect(JSON.parse(storage.getItem('budget_io_expenses')!)[0].name).toBe('Rent');
    });

    it('rejects a blank name', async () => {
      await expectAsync(service.addCategory('   ', 1500, 'Monthly', '2025-01-01', false)).toBeRejected();
    });

    it('rejects a non-positive budget', async () => {
      await expectAsync(service.addCategory('Rent', 0, 'Monthly', '2025-01-01', false)).toBeRejected();
      await expectAsync(service.addCategory('Rent', -5, 'Monthly', '2025-01-01', false)).toBeRejected();
    });

    it('rejects a missing due date', async () => {
      await expectAsync(service.addCategory('Rent', 1500, 'Monthly', '', false)).toBeRejected();
    });

    it('updates an existing category in place', async () => {
      await service.addCategory('Rent', 1500, 'Monthly', '2025-01-01', false);
      const existing = service.getCategoriesSnapshot()[0];

      await service.updateCategory({ ...existing, budget: 1600 });

      expect(service.getCategoriesSnapshot().length).toBe(1);
      expect(service.getCategoriesSnapshot()[0].budget).toBe(1600);
    });

    it('rejects an update to a category that does not exist', async () => {
      const orphan: ExpenseCategory = {
        id: 'missing', name: 'Ghost', budget: 100, frequency: 'Monthly', dueDate: '2025-01-01',
      };

      await expectAsync(service.updateCategory(orphan)).toBeRejected();
    });

    it('deletes a category by id and leaves the others alone', async () => {
      await service.addCategory('Rent', 1500, 'Monthly', '2025-01-01', false);
      await service.addCategory('Coffee', 10, 'Weekly', '2025-01-01', false);
      const rentId = service.getCategoriesSnapshot().find(c => c.name === 'Rent')!.id;

      await service.deleteCategory(rentId);

      expect(service.getCategoriesSnapshot().map(c => c.name)).toEqual(['Coffee']);
    });

    it('assigns each category a distinct id', async () => {
      await service.addCategory('Rent', 1500, 'Monthly', '2025-01-01', false);
      await service.addCategory('Coffee', 10, 'Weekly', '2025-01-01', false);

      const [first, second] = service.getCategoriesSnapshot();
      expect(first.id).not.toBe(second.id);
    });

    it('hands out a copy of the snapshot, not the live array', async () => {
      await service.addCategory('Rent', 1500, 'Monthly', '2025-01-01', false);

      service.getCategoriesSnapshot().push(expense({ frequency: 'Monthly', dueDate: '2025-01-01' }));

      expect(service.getCategoriesSnapshot().length).toBe(1);
    });
  });

  describe('income persistence', () => {
    it('adds an income source and pushes it to subscribers', async () => {
      await service.addIncomeSource('Salary', 3000, 'Monthly', '2025-01-01');

      expect(service.getIncomeSourcesSnapshot().length).toBe(1);
      expect(service.getIncomeSourcesSnapshot()[0].amount).toBe(3000);
    });

    it('rejects invalid income data', async () => {
      await expectAsync(service.addIncomeSource('', 3000, 'Monthly', '2025-01-01')).toBeRejected();
      await expectAsync(service.addIncomeSource('Salary', 0, 'Monthly', '2025-01-01')).toBeRejected();
      await expectAsync(service.addIncomeSource('Salary', 3000, 'Monthly', '')).toBeRejected();
    });

    it('updates and deletes an income source', async () => {
      await service.addIncomeSource('Salary', 3000, 'Monthly', '2025-01-01');
      const existing = service.getIncomeSourcesSnapshot()[0];

      await service.updateIncomeSource({ ...existing, amount: 3500 });
      expect(service.getIncomeSourcesSnapshot()[0].amount).toBe(3500);

      await service.deleteIncomeSource(existing.id);
      expect(service.getIncomeSourcesSnapshot()).toEqual([]);
    });
  });

  describe('currency', () => {
    it('defaults to CAD when nothing is stored', () => {
      expect(service.getCurrencySnapshot()).toBe('CAD');
    });

    it('persists a change and notifies subscribers', () => {
      const emitted: string[] = [];
      service.currency$.subscribe(c => emitted.push(c));

      service.setCurrency('EUR');

      expect(service.getCurrencySnapshot()).toBe('EUR');
      expect(storage.getItem('budget_io_currency')).toBe('EUR');
      expect(emitted).toEqual(['CAD', 'EUR']);
    });
  });

  describe('bulk replace (used by Settings import)', () => {
    it('replaces all expenses and notifies subscribers', async () => {
      await service.addCategory('Old', 100, 'Monthly', '2025-01-01', false);
      const imported = [expense({ id: 'imported', name: 'Imported', frequency: 'Monthly', dueDate: '2025-02-01' })];

      service.replaceExpenses(imported);

      expect(service.getCategoriesSnapshot().map(c => c.name)).toEqual(['Imported']);
    });

    it('replaces all incomes', () => {
      service.replaceIncomes([income({ id: 'imported', name: 'Imported', frequency: 'Monthly', receiveDate: '2025-02-01' })]);

      expect(service.getIncomeSourcesSnapshot().map(i => i.name)).toEqual(['Imported']);
    });
  });

  describe('corrupt storage', () => {
    it('falls back to an empty budget rather than throwing', () => {
      storage.setItem('budget_io_expenses', '{not valid json');

      // A fresh instance reads the corrupt value on construction.
      expect(() => new BudgetService()).not.toThrow();
      expect(new BudgetService().getCategoriesSnapshot()).toEqual([]);
    });
  });
});
