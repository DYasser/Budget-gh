import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc, query, orderBy } from '@angular/fire/firestore';
import { parseISO, lastDayOfMonth, addMonths, addWeeks, addYears, format, startOfDay, endOfDay } from 'date-fns';
import { CalendarEvent } from 'angular-calendar'; // Keep for getCalendarEventsForPeriod

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

interface ExpenseCategoryData {
  name: string;
  budget: number;
  frequency: BudgetFrequency;
  dueDate: string;
  isDueEndOfMonth?: boolean;
}

interface EventColor { primary: string; secondary: string; }

@Injectable({
  providedIn: 'root'
})
export class BudgetService {

  private firestore: Firestore = inject(Firestore);
  private categoriesCollection = collection(this.firestore, 'expenseCategories');
  categories$: Observable<ExpenseCategory[]>;

  private readonly colorPalette: string[] = [
    '#36A2EB', '#FF6384', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#C9CBCF', '#7CFFC4', '#FF7C7C', '#BDB2FF'
  ];

  constructor() {
    const categoriesQuery = query(this.categoriesCollection, orderBy('name'));
    this.categories$ = collectionData(categoriesQuery, { idField: 'id' }) as Observable<ExpenseCategory[]>;
  }
  
  getRelevantCategoriesForMonth(categories: ExpenseCategory[], targetDate: Date): ExpenseCategory[] {
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear();
      return categories.filter(cat => {
          let isRelevant = false; if (!cat.dueDate) return false;
          try {
              const startDate = parseISO(cat.dueDate); if (isNaN(startDate.getTime())) throw new Error();
              const dueMonth = startDate.getMonth(); const dueYear = startDate.getFullYear();
              if (cat.frequency === 'Weekly' || cat.frequency === 'Bi-Weekly') { isRelevant = true; }
              else if (cat.frequency === 'Monthly') {
                  if (cat.isDueEndOfMonth) { isRelevant = (dueYear < targetYear) || (dueYear === targetYear && dueMonth <= targetMonth); }
                  else { isRelevant = true; }
              } else { isRelevant = (dueMonth === targetMonth && dueYear === targetYear); }
          } catch (e) { isRelevant = false; }
          return isRelevant;
      });
  }

  // This method calculates the total by summing budgets for each occurrence in the month
  calculateTotalOccurrencesBudgetForMonth(categories: ExpenseCategory[], targetDate: Date): number {
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear();
      let totalBudgetInMonth = 0;

      categories.forEach(cat => {
          if (!cat.dueDate) return;
          try {
              let startDate = parseISO(cat.dueDate); if (isNaN(startDate.getTime())) { throw new Error('Invalid start date'); }
              let baseOccurrence = startDate;
              if (cat.frequency === 'Monthly' && cat.isDueEndOfMonth) { baseOccurrence = lastDayOfMonth(startDate); }
              let iterations = 0; const maxIterations = 500; let nextOccurrence = baseOccurrence;

              while (iterations < maxIterations) {
                  iterations++;
                  let occurrenceDate = nextOccurrence;
                  if (cat.frequency === 'Monthly' && cat.isDueEndOfMonth) { occurrenceDate = lastDayOfMonth(nextOccurrence); }
                  const occMonth = occurrenceDate.getMonth(); const occYear = occurrenceDate.getFullYear();

                  if (occYear > targetYear || (occYear === targetYear && occMonth > targetMonth)) {
                       if (cat.frequency !== 'Weekly' && cat.frequency !== 'Bi-Weekly') { break; }
                       if (occYear > targetYear && (occMonth > 0 || targetMonth < 11)) break;
                       if (occYear === targetYear && occMonth > targetMonth + 1 ) break;
                  }
                  if (occMonth === targetMonth && occYear === targetYear && occurrenceDate >= startDate) {
                      totalBudgetInMonth += cat.budget;
                  }
                  switch (cat.frequency) {
                      case 'One-Time': iterations = maxIterations; break;
                      case 'Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations); break;
                      case 'Bi-Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations * 2); break;
                      case 'Monthly': let nextMonthDate = addMonths(startDate, iterations);
                          if (cat.isDueEndOfMonth) { nextOccurrence = lastDayOfMonth(nextMonthDate); }
                          else { const targetDay = startDate.getDate(); const daysInNextMonth = lastDayOfMonth(nextMonthDate).getDate(); nextOccurrence = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), Math.min(targetDay, daysInNextMonth)); } break;
                      case 'Quarterly': nextOccurrence = addMonths(startDate, iterations * 3); break;
                      case 'Annually': nextOccurrence = addYears(startDate, iterations); break;
                  }
                  if(iterations === maxIterations) { console.warn("Max iterations reached calculating total for category", cat.name); }
              }
          } catch (e) { console.error(`Error calculating total for category "${cat.name}":`, e); }
      });
      return totalBudgetInMonth;
  }

  getCalendarEventsForPeriod(categories: ExpenseCategory[], period: { start: Date, end: Date }): CalendarEvent<{ category: ExpenseCategory }>[] {
    const generatedEvents: CalendarEvent<{ category: ExpenseCategory }>[] = [];
    const periodInterval = { start: startOfDay(period.start), end: endOfDay(period.end) };
    categories.forEach((category, catIndex) => {
        if (!category.dueDate) return;
        try {
            let startDate = parseISO(category.dueDate); if (isNaN(startDate.getTime())) { throw new Error('Invalid start date'); }
            const title = `${category.name}: $${category.budget.toFixed(0)}`;
            const color = category.color || this.getColorByIndex(catIndex);
            const eventColor = { primary: color, secondary: this.adjustColorOpacity(color, 0.6) };
            let baseOccurrence = startDate; if (category.frequency === 'Monthly' && category.isDueEndOfMonth) { baseOccurrence = lastDayOfMonth(startDate); }
            let iterations = 0; const maxIterations = 1000; let nextOccurrence = baseOccurrence;
            while (nextOccurrence <= periodInterval.end && iterations < maxIterations) {
                iterations++; let occurrenceDate = nextOccurrence;
                if (category.frequency === 'Monthly' && category.isDueEndOfMonth) { occurrenceDate = lastDayOfMonth(nextOccurrence); }
                if (occurrenceDate >= periodInterval.start && occurrenceDate >= startDate && occurrenceDate <= periodInterval.end) {
                      generatedEvents.push({ id: `${category.id}_${format(occurrenceDate, 'yyyyMMdd')}`, start: occurrenceDate, title: title, color: eventColor, allDay: true, meta: { category } });
                }
                if (occurrenceDate > periodInterval.end && !(category.frequency === 'Monthly' && category.isDueEndOfMonth)) { break; }
                switch (category.frequency) {
                    case 'One-Time': iterations = maxIterations; break;
                    case 'Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations); break;
                    case 'Bi-Weekly': nextOccurrence = addWeeks(baseOccurrence, iterations * 2); break;
                    case 'Monthly': let nextMonthDate = addMonths(startDate, iterations);
                        if (category.isDueEndOfMonth) { nextOccurrence = lastDayOfMonth(nextMonthDate); }
                        else { const targetDay = startDate.getDate(); const daysInNextMonth = lastDayOfMonth(nextMonthDate).getDate(); nextOccurrence = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), Math.min(targetDay, daysInNextMonth)); } break;
                    case 'Quarterly': nextOccurrence = addMonths(startDate, iterations * 3); break;
                    case 'Annually': nextOccurrence = addYears(startDate, iterations); break;
                } if(iterations === maxIterations) { console.warn("Max iterations reached for category", category.name); }
            }
        } catch (e) { console.error(`Error processing category "${category.name}" with date "${category.dueDate}" for calendar events:`, e); }
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

  public getColorByIndex(index: number): string {
      return this.colorPalette[index % this.colorPalette.length];
  }
}