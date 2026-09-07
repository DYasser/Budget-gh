import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BudgetService, ExpenseCategory, IncomeSource } from '../budget.service';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationDialogComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit, OnDestroy {

  readonly currencies = [
    { code: 'USD', label: 'USD — US Dollar' },
    { code: 'CAD', label: 'CAD — Canadian Dollar' },
    { code: 'EUR', label: 'EUR — Euro' },
    { code: 'GBP', label: 'GBP — British Pound' },
    { code: 'JPY', label: 'JPY — Japanese Yen' },
    { code: 'AUD', label: 'AUD — Australian Dollar' },
    { code: 'CHF', label: 'CHF — Swiss Franc' },
    { code: 'CNY', label: 'CNY — Chinese Yuan' },
    { code: 'INR', label: 'INR — Indian Rupee' },
    { code: 'MXN', label: 'MXN — Mexican Peso' }
  ];

  selectedCurrency = 'CAD';
  private currencySubscription!: Subscription;

  showImportConfirm = false;
  importConfirmMessage = '';
  private pendingImportData: { expenses?: ExpenseCategory[], incomes?: IncomeSource[], currency?: string } | null = null;
  importStatusMessage: string | null = null;
  importStatusType: 'success' | 'error' | null = null;

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  constructor(private budgetService: BudgetService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.currencySubscription = this.budgetService.currency$.subscribe(code => {
      this.selectedCurrency = code;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    if (this.currencySubscription) { this.currencySubscription.unsubscribe(); }
  }

  onCurrencyChange(code: string): void {
    this.budgetService.setCurrency(code);
  }

  private getTodayString(): string {
    const d = new Date();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  private triggerDownload(data: object, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportAll(): void {
    this.triggerDownload({
      expenses: this.budgetService.getCategoriesSnapshot(),
      incomes: this.budgetService.getIncomeSourcesSnapshot(),
      currency: this.budgetService.getCurrencySnapshot()
    }, `budget-io-all-${this.getTodayString()}.json`);
  }

  exportExpenses(): void {
    this.triggerDownload(
      { expenses: this.budgetService.getCategoriesSnapshot() },
      `budget-io-expenses-${this.getTodayString()}.json`
    );
  }

  exportIncomes(): void {
    this.triggerDownload(
      { incomes: this.budgetService.getIncomeSourcesSnapshot() },
      `budget-io-incomes-${this.getTodayString()}.json`
    );
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!parsed.expenses && !parsed.incomes) {
          throw new Error('File must contain an "expenses" and/or "incomes" array.');
        }
        this.pendingImportData = parsed;
        this.importConfirmMessage = 'This will overwrite your existing budget data. Are you sure?';
        this.showImportConfirm = true;
        this.importStatusMessage = null;
        this.importStatusType = null;
        this.cdr.detectChanges();
      } catch (err: any) {
        this.importStatusMessage = `Import failed: ${err.message || 'Invalid file.'}`;
        this.importStatusType = 'error';
        this.cdr.detectChanges();
      }
      if (this.fileInputRef) { this.fileInputRef.nativeElement.value = ''; }
    };
    reader.readAsText(file);
  }

  confirmImport(): void {
    this.showImportConfirm = false;
    if (!this.pendingImportData) { return; }
    if (this.pendingImportData.expenses) {
      this.budgetService.replaceExpenses(this.pendingImportData.expenses);
    }
    if (this.pendingImportData.incomes) {
      this.budgetService.replaceIncomes(this.pendingImportData.incomes);
    }
    if (this.pendingImportData.currency) {
      this.budgetService.setCurrency(this.pendingImportData.currency);
    }
    this.importStatusMessage = 'Data imported successfully.';
    this.importStatusType = 'success';
    this.pendingImportData = null;
    this.cdr.detectChanges();
  }

  cancelImport(): void {
    this.showImportConfirm = false;
    this.pendingImportData = null;
  }
}
