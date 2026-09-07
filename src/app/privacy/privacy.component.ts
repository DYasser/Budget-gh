import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './privacy.component.html',
  styleUrls: ['./privacy.component.css']
})
export class PrivacyComponent {
  /** Everything this app writes to the browser, so the page can list it exactly. */
  readonly storedItems = [
    { key: 'budget_io_expenses', store: 'Local storage', holds: 'Your expense categories: name, amount, frequency and due date.' },
    { key: 'budget_io_incomes', store: 'Local storage', holds: 'Your income sources: name, amount, frequency and pay date.' },
    { key: 'budget_io_currency', store: 'Local storage', holds: 'The currency you picked in Settings.' },
    { key: 'dashboardWelcomed', store: 'Session storage', holds: 'Whether the welcome animation has already played. Cleared when you close the tab.' },
  ];
}
