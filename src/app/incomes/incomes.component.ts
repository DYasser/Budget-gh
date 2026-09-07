import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BudgetService, IncomeSource, BudgetFrequency } from '../budget.service';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component'; // Import dialog

@Component({
  selector: 'app-incomes',
  standalone: true,
  imports: [ CommonModule, FormsModule, ConfirmationDialogComponent ], // Add dialog component
  templateUrl: './incomes.component.html',
  styleUrls: ['./incomes.component.css']
})
export class IncomesComponent implements OnInit, OnDestroy {

  @ViewChild('inputColumn') inputColumnRef!: ElementRef<HTMLDivElement>;
  @ViewChild('incomeNameInput') incomeNameInputRef!: ElementRef<HTMLInputElement>;

  incomeSources: IncomeSource[] = [];
  private incomeSubscription!: Subscription;

  newIncomeName = '';
  newIncomeAmount: number | null = null;
  newIncomeFrequency: BudgetFrequency = 'Monthly';
  newIncomeReceiveDate = '';

  editingIncomeSource: IncomeSource | null = null;
  isSaving = false;
  isDeleting: Record<string, boolean> = {};

  showIncomeDeleteConfirm = false;
  incomeSourceToDelete: IncomeSource | null = null;

  budgetFrequencies: BudgetFrequency[] = ['Monthly', 'Weekly', 'Bi-Weekly', 'Quarterly', 'Annually', 'One-Time'];
  toastMessage: string | null = null;
  toastType: 'success' | 'error' | null = null;
  private toastTimeout: any = null;


  constructor(private budgetService: BudgetService, private cdr: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.incomeSubscription = this.budgetService.incomeSources$.subscribe(incomes => {
      this.incomeSources = incomes;
      this.cdr.detectChanges();
    });
    this.newIncomeReceiveDate = this.getTodayDateString();
  }

  ngOnDestroy(): void {
    if (this.incomeSubscription) { this.incomeSubscription.unsubscribe(); }
    clearTimeout(this.toastTimeout);
  }

  getTodayDateString(): string {
      const today = new Date();
      const month = (today.getMonth() + 1).toString().padStart(2, '0');
      const day = today.getDate().toString().padStart(2, '0');
      return `${today.getFullYear()}-${month}-${day}`;
  }

  async saveIncomeSource(): Promise<void> {
    if (!this.newIncomeName.trim() || this.newIncomeAmount === null || this.newIncomeAmount <= 0 || !this.newIncomeReceiveDate) { this.showToast('Please enter valid details (Name, Amount > 0, Date).', 'error'); return; }
    this.isSaving = true;
    try {
        if (this.editingIncomeSource) {
          const updatedData: IncomeSource = { id: this.editingIncomeSource.id, name: this.newIncomeName.trim(), amount: this.newIncomeAmount, frequency: this.newIncomeFrequency, receiveDate: this.newIncomeReceiveDate };
          await this.budgetService.updateIncomeSource(updatedData); this.showToast('Income source updated!', 'success');
        } else {
          await this.budgetService.addIncomeSource( this.newIncomeName.trim(), this.newIncomeAmount, this.newIncomeFrequency, this.newIncomeReceiveDate ); this.showToast('Income source added!', 'success');
        } this.resetForm();
    } catch (error) { console.error("Error saving income source:", error); this.showToast('Failed to save income source.', 'error');
    } finally { this.isSaving = false; this.cdr.detectChanges(); }
  }

  editIncomeSource(income: IncomeSource): void {
    this.editingIncomeSource = income; this.newIncomeName = income.name; this.newIncomeAmount = income.amount;
    this.newIncomeFrequency = income.frequency; this.newIncomeReceiveDate = income.receiveDate;
    this.focusInlineForm();
  }

  cancelEditIncomeSource(): void { this.resetForm(); }

  private resetForm(): void {
    this.editingIncomeSource = null; this.newIncomeName = ''; this.newIncomeAmount = null;
    this.newIncomeFrequency = 'Monthly'; this.newIncomeReceiveDate = this.getTodayDateString();
  }

   private focusInlineForm(): void {
     setTimeout(() => {
        if (this.inputColumnRef) { this.inputColumnRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
       setTimeout(() => { if (this.incomeNameInputRef) { this.incomeNameInputRef.nativeElement.select(); } }, 300);
     }, 0);
  }

  deleteIncomeSource(incomeId: string): void {
    const income = this.incomeSources.find(i => i.id === incomeId);
    if (income) {
      this.incomeSourceToDelete = income;
      this.showIncomeDeleteConfirm = true;
    } else { console.log('Income source not found for deletion.'); }
  }

  async confirmIncomeDeletion(): Promise<void> {
    if (!this.incomeSourceToDelete) return;
    const idToDelete = this.incomeSourceToDelete.id;
    this.isDeleting[idToDelete] = true;
    this.showIncomeDeleteConfirm = false;
    this.cdr.detectChanges();
    try {
        await this.budgetService.deleteIncomeSource(idToDelete);
        this.showToast('Income source deleted.', 'success');
        if (this.editingIncomeSource?.id === idToDelete) { this.resetForm(); }
    } catch (error) {
        console.error("Error deleting income source:", error);
        this.showToast('Failed to delete income source.', 'error');
    } finally {
         delete this.isDeleting[idToDelete];
         this.incomeSourceToDelete = null;
         this.cdr.detectChanges();
    }
  }

  cancelIncomeDeletion(): void {
    this.showIncomeDeleteConfirm = false;
    this.incomeSourceToDelete = null;
  }

  showToast(message: string, type: 'success' | 'error', duration = 3000): void {
    clearTimeout(this.toastTimeout);
    this.toastMessage = message; this.toastType = type; this.cdr.detectChanges();
    this.toastTimeout = setTimeout(() => { this.toastMessage = null; this.toastType = null; this.cdr.detectChanges(); }, duration);
  }
}