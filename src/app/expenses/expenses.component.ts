import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BudgetService, ExpenseCategory, BudgetFrequency } from '../budget.service';
import { parseISO, lastDayOfMonth, addMonths, addWeeks, addYears } from 'date-fns';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component'; // Import dialog

interface Transaction { id: number; date: string; categoryId: string; categoryName: string; amount: number; description: string; }
interface CategoryPercentage extends ExpenseCategory { percentage: number; color: string; monthlyEquivalent: number; }

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [ CommonModule, FormsModule, CurrencyPipe, ConfirmationDialogComponent ], // Add dialog component
  templateUrl: './expenses.component.html',
  styleUrls: ['./expenses.component.css']
})
export class ExpensesComponent implements OnInit, OnDestroy {

  @ViewChild('inputColumn') inputColumnRef!: ElementRef<HTMLDivElement>;
  @ViewChild('categoryNameInput') categoryNameInputRef!: ElementRef<HTMLInputElement>;

  expenseCategories: ExpenseCategory[] = [];
  private categoriesSubscription!: Subscription;

  isSaving: boolean = false; 
  isDeleting: { [key: string]: boolean } = {};

  showDeleteConfirm: boolean = false; // State for dialog visibility
  categoryToDelete: ExpenseCategory | null = null; // Store category to delete

  toastMessage: string | null = null;
  toastType: 'success' | 'error' | null = null;
  private toastTimeout: any = null;

  newCategoryName: string = '';
  newCategoryBudget: number | null = null;
  newCategoryFrequency: BudgetFrequency = 'Monthly';
  newCategoryDueDate: string = '';
  newCategoryIsDueEndOfMonth: boolean = false;

  editingCategory: ExpenseCategory | null = null;

  transactions: Transaction[] = [];
  newTransactionAmount: number | null = null;
  newTransactionDate: string = '';
  newTransactionCategory: string | null = null;
  newTransactionDescription: string = '';
  private nextTransactionId = 1;

  categoryProportions: CategoryPercentage[] = [];
  budgetFrequencies: BudgetFrequency[] = ['Monthly', 'Weekly', 'Bi-Weekly', 'Quarterly', 'Annually', 'One-Time'];
  currentMonthName: string = '';
  currentMonthTotalEquivalentBudget: number = 0;

  private readonly WEEKS_IN_MONTH = 52 / 12;
  private readonly BIWEEKS_IN_MONTH = 26 / 12;

  constructor(private budgetService: BudgetService, private cdr: ChangeDetectorRef) { }

  ngOnInit(): void {
    const now = new Date();
    this.currentMonthName = now.toLocaleString('default', { month: 'long' });

    this.categoriesSubscription = this.budgetService.categories$.subscribe(categories => {
      this.expenseCategories = categories;
      this.calculateCurrentMonthProportions();
    });
    this.newTransactionDate = this.getTodayDateString();
    this.newCategoryDueDate = this.getTodayDateString();
    this.newCategoryIsDueEndOfMonth = false;
  }

  ngOnDestroy(): void {
      if (this.categoriesSubscription) {
          this.categoriesSubscription.unsubscribe();
      }
  }

  getTodayDateString(): string {
      const today = new Date();
      const month = (today.getMonth() + 1).toString().padStart(2, '0');
      const day = today.getDate().toString().padStart(2, '0');
      return `${today.getFullYear()}-${month}-${day}`;
  }

  calculateCurrentMonthProportions(): void {
      const today = new Date();
      const allCurrentCategories = this.expenseCategories;

      this.currentMonthTotalEquivalentBudget = this.budgetService.calculateTotalOccurrencesBudgetForMonth(allCurrentCategories, today);
      const relevantCategories = this.budgetService.getRelevantCategoriesForMonth(allCurrentCategories, today);

      const categoriesForProportionBars = relevantCategories.map((cat, index) => {
          let monthlyEquivalent = 0;
           switch (cat.frequency) {
               case 'Monthly':   monthlyEquivalent = cat.budget; break;
               case 'Weekly':    monthlyEquivalent = cat.budget * this.WEEKS_IN_MONTH; break;
               case 'Bi-Weekly': monthlyEquivalent = cat.budget * this.BIWEEKS_IN_MONTH; break;
               case 'Quarterly': monthlyEquivalent = cat.budget / 3; break;
               case 'Annually':  monthlyEquivalent = cat.budget / 12; break;
               case 'One-Time':  monthlyEquivalent = 0; break;
           }
          return {
              ...cat,
              monthlyEquivalent: monthlyEquivalent,
              percentage: 0,
              color: cat.color || this.budgetService.getColorByIndex(index)
          };
      }).filter(cat => cat.frequency !== 'One-Time');

      this.categoryProportions = categoriesForProportionBars.map(cat => ({
          ...cat,
          percentage: this.currentMonthTotalEquivalentBudget > 0 ? (cat.monthlyEquivalent / this.currentMonthTotalEquivalentBudget) * 100 : 0,
      }));

      this.cdr.detectChanges();
  }

  showToast(message: string, type: 'success' | 'error', duration: number = 3000): void {
    clearTimeout(this.toastTimeout); // Clear any existing toast timeout
    this.toastMessage = message;
    this.toastType = type;
    this.cdr.detectChanges(); // Make sure view updates

    this.toastTimeout = setTimeout(() => {
      this.toastMessage = null;
      this.toastType = null;
      this.cdr.detectChanges(); // Update view to hide toast
    }, duration);
  }

  async saveCategory(): Promise<void> {
    if (!this.newCategoryName.trim() || this.newCategoryBudget === null || this.newCategoryBudget <= 0 || !this.newCategoryDueDate) {
      // Replace alert with toast later if desired
      alert('Please enter a valid category name, a positive budget amount, and select a date.');
      return;
    }

    this.isSaving = true; // Start loading state

    const dateToSend = this.newCategoryDueDate;
    const endOfMonthFlag = this.newCategoryFrequency === 'Monthly' ? this.newCategoryIsDueEndOfMonth : false;

    try {
        if (this.editingCategory) {
          const updatedData: ExpenseCategory = {
            id: this.editingCategory.id, name: this.newCategoryName.trim(), budget: this.newCategoryBudget,
            frequency: this.newCategoryFrequency, dueDate: dateToSend, isDueEndOfMonth: endOfMonthFlag };
          await this.budgetService.updateCategory(updatedData);
          this.showToast('Category updated successfully!', 'success'); // Success feedback
        } else {
          await this.budgetService.addCategory( this.newCategoryName.trim(), this.newCategoryBudget, this.newCategoryFrequency, dateToSend, endOfMonthFlag );
          this.showToast('Category added successfully!', 'success'); // Success feedback
        }
        this.resetForm();
    } catch (error) {
        console.error("Error saving category:", error);
        this.showToast('Failed to save category. Please try again.', 'error'); // Error feedback
    } finally {
        this.isSaving = false; // End loading state regardless of success/failure
        this.cdr.detectChanges(); // Ensure button state updates
    }
  }


  editCategory(category: ExpenseCategory): void {
    this.editingCategory = category; this.newCategoryName = category.name; this.newCategoryBudget = category.budget;
    this.newCategoryFrequency = category.frequency; this.newCategoryDueDate = category.dueDate;
    this.newCategoryIsDueEndOfMonth = category.isDueEndOfMonth || false;
    setTimeout(() => { if (this.categoryNameInputRef) { this.categoryNameInputRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); this.categoryNameInputRef.nativeElement.focus(); } }, 0);
  }

  cancelEdit(): void { this.resetForm(); }

  private resetForm(): void {
    this.editingCategory = null; this.newCategoryName = ''; this.newCategoryBudget = null;
    this.newCategoryFrequency = 'Monthly'; this.newCategoryDueDate = this.getTodayDateString(); this.newCategoryIsDueEndOfMonth = false;
  }

  // Updated deleteCategory - shows dialog
  deleteCategory(categoryId: string): void {
    const category = this.expenseCategories.find(c => c.id === categoryId);
    if (category) {
      this.categoryToDelete = category;
      this.showDeleteConfirm = true;
    } else { console.log('Category not found for deletion.'); }
  }

  // New method - called when user confirms deletion in dialog
  async confirmDeletion(): Promise<void> {
    if (!this.categoryToDelete) return;
    const idToDelete = this.categoryToDelete.id;
    this.isDeleting[idToDelete] = true;
    this.showDeleteConfirm = false; // Close dialog immediately
    this.cdr.detectChanges();

    try {
        await this.budgetService.deleteCategory(idToDelete);
        this.showToast('Category deleted.', 'success');
        if (this.editingCategory?.id === idToDelete) {
            this.resetForm();
        }
    } catch (error) {
        console.error("Error deleting category:", error);
        this.showToast('Failed to delete category.', 'error');
    } finally {
         delete this.isDeleting[idToDelete];
         this.categoryToDelete = null; // Clear selected category
         this.cdr.detectChanges();
    }
  }

  // New method - called when user cancels deletion in dialog
  cancelDeletion(): void {
    this.showDeleteConfirm = false;
    this.categoryToDelete = null;
  }

  addTransaction(): void {
     if (this.newTransactionAmount === null || this.newTransactionAmount <= 0 || !this.newTransactionDate || this.newTransactionCategory === null) { alert('Please fill in Amount, Date, and Category for the transaction.'); return; }
     const selectedCategory = this.expenseCategories.find(c => c.id === this.newTransactionCategory);
     if (!selectedCategory) { alert('Selected category not found.'); return; }
     const newTransaction: Transaction = { id: this.nextTransactionId++, amount: this.newTransactionAmount, date: this.newTransactionDate, categoryId: selectedCategory.id, categoryName: selectedCategory.name, description: this.newTransactionDescription.trim() };
     this.transactions.push(newTransaction); console.log('Added Transaction (local):', newTransaction);
     this.newTransactionAmount = null; this.newTransactionCategory = null; this.newTransactionDescription = ''; this.newTransactionDate = this.getTodayDateString();
  }
}