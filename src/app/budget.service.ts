import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc, query, orderBy } from '@angular/fire/firestore';
import { parseISO, lastDayOfMonth, addMonths, addWeeks, addYears, format, startOfDay, endOfDay } from 'date-fns';
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

interface ExpenseCategoryData {
  name: string;
  budget: number;
  frequency: BudgetFrequency;
  dueDate: string;
  isDueEndOfMonth?: boolean;
}

interface IncomeSourceData {
  name: string;
  amount: number;
  frequency: BudgetFrequency;
  receiveDate: string;
}

interface EventColor { primary: string; secondary: string; }

export type CalendarMetaData = { type: 'expense', data: ExpenseCategory } | { type: 'income', data: IncomeSource };

@Injectable({
  providedIn: 'root'
})
export class BudgetService {

  private firestore: Firestore = inject(Firestore);
  private categoriesCollection = collection(this.firestore, 'expenseCategories');
  private incomeSourcesCollection = collection(this.firestore, 'incomeSources');

  categories$: Observable<ExpenseCategory[]>;
  incomeSources$: Observable<IncomeSource[]>;

  private readonly colorPalette: string[] = [
    '#36A2EB', '#FF6384', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#C9CBCF', '#7CFFC4', '#FF7C7C', '#BDB2FF'
  ];
  private readonly expenseColorPalette: string[] = [ '#FF6384', '#FF9F40', '#FFCD56', '#C9CBCF', '#FF7C7C' ];
  private readonly incomeColorPalette: string[] = [ '#36A2EB', '#4BC0C0', '#7CFFC4', '#9966FF', '#BDB2FF' ];
  private readonly WEEKS_IN_MONTH = 52 / 12;
  private readonly BIWEEKS_IN_MONTH = 26 / 12;


  constructor() {
    const categoriesQuery = query(this.categoriesCollection, orderBy('name'));
    this.categories$ = collectionData(categoriesQuery, { idField: 'id' }) as Observable<ExpenseCategory[]>;
    const incomeQuery = query(this.incomeSourcesCollection, orderBy('name'));
    this.incomeSources$ = collectionData(incomeQuery, { idField: 'id' }) as Observable<IncomeSource[]>;
  }

  getRelevantCategoriesForMonth(categories: ExpenseCategory[], targetDate: Date): ExpenseCategory[] {
      const targetMonth = targetDate.getMonth(); const targetYear = targetDate.getFullYear();
      return categories.filter(cat => {
          let isRelevant = false; if (!cat.dueDate) return false;
          try {
              const startDate = parseISO(cat.dueDate); if (isNaN(startDate.getTime())) throw new Error();
              const dueMonth = startDate.getMonth(); const dueYear = startDate.getFullYear();
              if (cat.frequency === 'Weekly' || cat.frequency === 'Bi-Weekly') { isRelevant = true; }
              else if (cat.frequency === 'Monthly') { if (cat.isDueEndOfMonth) { isRelevant = (dueYear < targetYear) || (dueYear === targetYear && dueMonth <= targetMonth); } else { isRelevant = true; } }
              else { isRelevant = (dueMonth === targetMonth && dueYear === targetYear); }
          } catch (e) { isRelevant = false; } return isRelevant;
      });
  }


  calculateTotalMonthlyEquivalentBudget(categories: ExpenseCategory[], targetDate: Date): number {
      const relevantCategories = this.getRelevantCategoriesForMonth(categories, targetDate);
      let totalMonthlyEquivalent = 0;
      relevantCategories.forEach(cat => {
          let monthlyEquivalent = 0;
          switch (cat.frequency) {
              case 'Monthly':   monthlyEquivalent = cat.budget; break;
              case 'Weekly':    monthlyEquivalent = cat.budget * this.WEEKS_IN_MONTH; break;
              case 'Bi-Weekly': monthlyEquivalent = cat.budget * this.BIWEEKS_IN_MONTH; break;
              case 'Quarterly': monthlyEquivalent = cat.budget / 3; break;
              case 'Annually':  monthlyEquivalent = cat.budget / 12; break;
              case 'One-Time':  monthlyEquivalent = cat.budget; break;
          } totalMonthlyEquivalent += monthlyEquivalent;
      }); return totalMonthlyEquivalent;
  }


  calculateTotalOccurrencesBudgetForMonth(categories: ExpenseCategory[], targetDate: Date): number {
      const targetMonth = targetDate.getMonth(); const targetYear = targetDate.getFullYear();
      let totalBudgetInMonth = 0;
      categories.forEach(cat => {
          if (!cat.dueDate) return;
          try {
              let startDate = parseISO(cat.dueDate); if (isNaN(startDate.getTime())) { throw new Error('Invalid start date'); }
              let baseOccurrence = startDate; if (cat.frequency === 'Monthly' && cat.isDueEndOfMonth) { baseOccurrence = lastDayOfMonth(startDate); }
              let iterations = 0; const maxIterations = 500; let nextOccurrence = baseOccurrence;
              while (iterations < maxIterations) {
                  iterations++; let occurrenceDate = nextOccurrence;
                  if (cat.frequency === 'Monthly' && cat.isDueEndOfMonth) { occurrenceDate = lastDayOfMonth(nextOccurrence); }
                  const occMonth = occurrenceDate.getMonth(); const occYear = occurrenceDate.getFullYear();
                  if (occYear > targetYear || (occYear === targetYear && occMonth > targetMonth)) {
                       if (cat.frequency !== 'Weekly' && cat.frequency !== 'Bi-Weekly') { break; }
                       if (occYear > targetYear && (occMonth > 0 || targetMonth < 11)) break;
                       if (occYear === targetYear && occMonth > targetMonth + 1 ) break;
                  }
                  if (occMonth === targetMonth && occYear === targetYear && occurrenceDate >= startDate) { totalBudgetInMonth += cat.budget; }
                  switch (cat.frequency) {
                      case 'One-Time': iterations = maxIterations; break;
                      case 'Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations); break;
                      case 'Bi-Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations * 2); break;
                      case 'Monthly': let nextMonthDate = addMonths(startDate, iterations);
                          if (cat.isDueEndOfMonth) { nextOccurrence = lastDayOfMonth(nextMonthDate); }
                          else { const targetDay = startDate.getDate(); const daysInNextMonth = lastDayOfMonth(nextMonthDate).getDate(); nextOccurrence = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), Math.min(targetDay, daysInNextMonth)); } break;
                      case 'Quarterly': nextOccurrence = addMonths(startDate, iterations * 3); break;
                      case 'Annually': nextOccurrence = addYears(startDate, iterations); break;
                  } if(iterations === maxIterations) { console.warn("Max iterations reached calculating total for category", cat.name); }
              }
          } catch (e) { console.error(`Error calculating total for category "${cat.name}":`, e); }
      }); return totalBudgetInMonth;
  }

  getCalendarEventsForPeriod(categories: ExpenseCategory[], incomeSources: IncomeSource[], period: { start: Date, end: Date }): CalendarEvent<CalendarMetaData>[] {
    const generatedEvents: CalendarEvent<CalendarMetaData>[] = [];
    const periodInterval = { start: startOfDay(period.start), end: endOfDay(period.end) };
    categories.forEach((category, catIndex) => {
        if (!category.dueDate) return;
        try {
            let startDate = parseISO(category.dueDate); if (isNaN(startDate.getTime())) { throw new Error(); }
            const title = `${category.name}: -$${category.budget.toFixed(0)}`;
            const color = category.color || this.expenseColorPalette[catIndex % this.expenseColorPalette.length];
            const eventColor = { primary: color, secondary: this.adjustColorOpacity(color, 0.6) };
            let baseOccurrence = startDate; if (category.frequency === 'Monthly' && category.isDueEndOfMonth) { baseOccurrence = lastDayOfMonth(startDate); }
            let iterations = 0; const maxIterations = 1000; let nextOccurrence = baseOccurrence;
            while (nextOccurrence <= periodInterval.end && iterations < maxIterations) {
                iterations++; let occurrenceDate = nextOccurrence;
                if (category.frequency === 'Monthly' && category.isDueEndOfMonth) { occurrenceDate = lastDayOfMonth(nextOccurrence); }
                if (occurrenceDate >= periodInterval.start && occurrenceDate >= startDate && occurrenceDate <= periodInterval.end) {
                      generatedEvents.push({ id: `exp_${category.id}_${format(occurrenceDate, 'yyyyMMdd')}`, start: occurrenceDate, title: title, color: eventColor, allDay: true, meta: { type: 'expense', data: category } });
                } if (occurrenceDate > periodInterval.end && !(category.frequency === 'Monthly' && category.isDueEndOfMonth)) { break; }
                switch (category.frequency) {
                    case 'One-Time': iterations = maxIterations; break;
                    case 'Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations); break;
                    case 'Bi-Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations * 2); break;
                    case 'Monthly': let nextMonthDate = addMonths(startDate, iterations);
                        if (category.isDueEndOfMonth) { nextOccurrence = lastDayOfMonth(nextMonthDate); }
                        else { const d = startDate.getDate(); const l = lastDayOfMonth(nextMonthDate).getDate(); nextOccurrence = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), Math.min(d, l)); } break;
                    case 'Quarterly': nextOccurrence = addMonths(startDate, iterations * 3); break;
                    case 'Annually': nextOccurrence = addYears(startDate, iterations); break;
                } if(iterations === maxIterations) { console.warn("Max iterations for category", category.name); }
            }
        } catch (e) { console.error(`Error processing category "${category.name}" date "${category.dueDate}":`, e); }
    });

    incomeSources.forEach((income, incomeIndex) => {
         if (!income.receiveDate) return;
         try {
            let startDate = parseISO(income.receiveDate); if (isNaN(startDate.getTime())) { throw new Error(); }
            const title = `${income.name}: +$${income.amount.toFixed(0)}`;
            const color = this.incomeColorPalette[incomeIndex % this.incomeColorPalette.length];
            const eventColor = { primary: color, secondary: this.adjustColorOpacity(color, 0.6) };
            let baseOccurrence = startDate; let iterations = 0; const maxIterations = 1000; let nextOccurrence = baseOccurrence;
            while (nextOccurrence <= periodInterval.end && iterations < maxIterations) {
                iterations++; let occurrenceDate = nextOccurrence;
                if (occurrenceDate >= periodInterval.start && occurrenceDate >= startDate && occurrenceDate <= periodInterval.end) {
                      generatedEvents.push({ id: `inc_${income.id}_${format(occurrenceDate, 'yyyyMMdd')}`, start: occurrenceDate, title: title, color: eventColor, allDay: true, meta: { type: 'income', data: income } });
                } if (occurrenceDate > periodInterval.end) { break; }
                switch (income.frequency) {
                    case 'One-Time': iterations = maxIterations; break;
                    case 'Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations); break;
                    case 'Bi-Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations * 2); break;
                    case 'Monthly': let nextMonthDate = addMonths(startDate, iterations); const targetDay = startDate.getDate(); const daysInNextMonth = lastDayOfMonth(nextMonthDate).getDate(); nextOccurrence = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), Math.min(targetDay, daysInNextMonth)); break;
                    case 'Quarterly': nextOccurrence = addMonths(startDate, iterations * 3); break;
                    case 'Annually': nextOccurrence = addYears(startDate, iterations); break;
                } if(iterations === maxIterations) { console.warn("Max iterations for income", income.name); }
            }
         } catch (e) { console.error(`Error processing income "${income.name}" date "${income.receiveDate}":`, e); }
    });

    generatedEvents.sort((a, b) => a.start.getTime() - b.start.getTime()); return generatedEvents;
 }

 private adjustColorOpacity(color: string, opacity: number): string {
      if (color.startsWith('#') && color.length === 7) { const r = parseInt(color.slice(1, 3), 16); const g = parseInt(color.slice(3, 5), 16); const b = parseInt(color.slice(5, 7), 16); return `rgba(${r}, ${g}, ${b}, ${opacity})`; }
      return 'rgba(100, 100, 100, 0.3)';
  }

  async addCategory(name: string, budget: number, frequency: BudgetFrequency, dueDate: string, isDueEndOfMonth: boolean): Promise<void> {
    if (!name.trim() || budget === null || budget <= 0 || !dueDate) { throw new Error("Invalid data for adding category"); }
    const newCategoryData = { name: name.trim(), budget: budget, frequency: frequency, dueDate: dueDate, isDueEndOfMonth: isDueEndOfMonth };
    try { await addDoc(this.categoriesCollection, newCategoryData); } catch (e) { console.error("Error adding category: ", e); throw e; }
  }

  async updateCategory(updatedCategory: ExpenseCategory): Promise<void> {
     if (!updatedCategory.id || !updatedCategory.dueDate) { throw new Error("Cannot update category without ID or due date"); }
     const docRef = doc(this.firestore, 'expenseCategories', updatedCategory.id);
     const updatePayload = { name: updatedCategory.name, budget: updatedCategory.budget, frequency: updatedCategory.frequency, dueDate: updatedCategory.dueDate, isDueEndOfMonth: updatedCategory.isDueEndOfMonth ?? false };
     try { await updateDoc(docRef, updatePayload); } catch (e) { console.error("Error updating category: ", e); throw e; }
  }

  async deleteCategory(id: string): Promise<void> {
    if (!id) { throw new Error("Cannot delete category without ID"); }
    const docRef = doc(this.firestore, 'expenseCategories', id);
    try { await deleteDoc(docRef); } catch (e) { console.error("Error deleting category: ", e); throw e; }
  }

  async addIncomeSource(name: string, amount: number, frequency: BudgetFrequency, receiveDate: string): Promise<void> {
    if (!name.trim() || amount === null || amount <= 0 || !receiveDate) { throw new Error("Invalid data for adding income source"); }
    const newIncomeData = { name: name.trim(), amount: amount, frequency: frequency, receiveDate: receiveDate };
    try { await addDoc(this.incomeSourcesCollection, newIncomeData); } catch (e) { console.error("Error adding income source: ", e); throw e; }
  }

  async updateIncomeSource(updatedIncomeSource: IncomeSource): Promise<void> {
    if (!updatedIncomeSource.id || !updatedIncomeSource.receiveDate) { throw new Error("Cannot update income source without ID or receive date"); }
    const docRef = doc(this.firestore, 'incomeSources', updatedIncomeSource.id);
    const updatePayload = { name: updatedIncomeSource.name, amount: updatedIncomeSource.amount, frequency: updatedIncomeSource.frequency, receiveDate: updatedIncomeSource.receiveDate };
    try { await updateDoc(docRef, updatePayload); } catch (e) { console.error("Error updating income source: ", e); throw e; }
  }

  async deleteIncomeSource(id: string): Promise<void> {
    if (!id) { throw new Error("Cannot delete income source without ID"); }
    const docRef = doc(this.firestore, 'incomeSources', id);
    try { await deleteDoc(docRef); } catch (e) { console.error("Error deleting income source: ", e); throw e; }
  }

  public getColorByIndex(index: number): string {
      return this.colorPalette[index % this.colorPalette.length];
  }

  getCategoriesSnapshot(): ExpenseCategory[] {
    let currentCategories: ExpenseCategory[] = [];
    this.categories$.subscribe(cats => currentCategories = cats).unsubscribe(); // Quick subscribe/unsubscribe
    // Note: A more robust way might involve storing the last emitted value internally
    return [...currentCategories]; // Return a copy
  }

  getIncomeSourcesSnapshot(): IncomeSource[] {
      let currentIncomes: IncomeSource[] = [];
      this.incomeSources$.subscribe(incs => currentIncomes = incs).unsubscribe();
      return [...currentIncomes];
  }
}