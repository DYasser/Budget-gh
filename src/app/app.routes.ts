import { Routes } from '@angular/router';
import { MainMenuComponent } from './main-menu/main-menu.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ExpensesComponent } from './expenses/expenses.component';
import { CalendarComponent } from './calendar/calendar.component';
import { SettingsComponent } from './settings/settings.component';
import { IncomesComponent } from './incomes/incomes.component';

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
  // { path: 'privacy', component: PrivacyPolicyComponent },
  // { path: 'terms', component: TermsComponent },
  // { path: 'contact', component: ContactComponent },

  // Optional: Wildcard route for 404 pages
  // { path: '**', component: PageNotFoundComponent }
];