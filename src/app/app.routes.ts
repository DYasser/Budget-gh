import { Routes } from '@angular/router';
import { MainMenuComponent } from './main-menu/main-menu.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ExpensesComponent } from './expenses/expenses.component';
import { CalendarComponent } from './calendar/calendar.component';
import { SettingsComponent } from './settings/settings.component';
import { IncomesComponent } from './incomes/incomes.component';
import { PrivacyComponent } from './privacy/privacy.component';

export const routes: Routes = [
  {
    path: '',
    component: MainMenuComponent,
    title: 'Login - budget.io'
  },
  {
    path: 'dashboard',
    component: DashboardComponent,
    title: 'Dashboard - budget.io'
  },
  {
    path: 'expenses',
    component: ExpensesComponent,
    title: 'Expenses - budget.io' 
  },
  {
    path: 'calendar', 
    component: CalendarComponent, 
    title: 'Calendar - budget.io' 
  },
  {
    path: 'settings', 
    component: SettingsComponent, 
    title: 'Settings - budget.io' 
  },
  { path: 'incomes', 
    component: IncomesComponent, 
    title: 'Incomes - budget.io' 
  },
  {
    path: 'privacy',
    component: PrivacyComponent,
    title: 'Privacy - budget.io'
  },
  // Unknown paths fall back to the dashboard rather than a blank screen.
  { path: '**', redirectTo: 'dashboard' }
];