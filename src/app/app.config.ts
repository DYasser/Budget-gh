import { ApplicationConfig, importProvidersFrom, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';

import {
    Chart,
    DoughnutController, ArcElement,
    BarController, BarElement, CategoryScale, LinearScale,
    Tooltip, Legend
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

import { CalendarA11y, CalendarDateFormatter, DateAdapter, CalendarEventTitleFormatter } from 'angular-calendar'; 
import { adapterFactory } from 'angular-calendar/date-adapters/date-fns'; 
import { CalendarUtils } from 'angular-calendar'; 
import { CommonModule, I18nPluralPipe } from '@angular/common';
import { provideServiceWorker } from '@angular/service-worker';
Chart.register(
    DoughnutController,
    BarController,
    ArcElement,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    ChartDataLabels
);


export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(CommonModule),
    provideRouter(routes),
    provideAnimations(),

    { provide: DateAdapter, useFactory: adapterFactory },
    CalendarUtils,
    CalendarDateFormatter,
    CalendarA11y,
    CalendarEventTitleFormatter,
    I18nPluralPipe,

    // Offline support. Disabled in development so a cached shell never masks a
    // code change; registered once the app settles so it does not compete with
    // first paint.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
