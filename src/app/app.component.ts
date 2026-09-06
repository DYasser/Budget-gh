import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, Event as RouterEvent } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { FooterComponent } from './footer/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
      CommonModule, 
      RouterOutlet,
      FooterComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'budget.io';
  showBackButton = false;
  private routerSubscription!: Subscription;

  constructor(
    private router: Router,
    private location: Location 
  ) {}

  ngOnInit(): void {
    this.routerSubscription = this.router.events.pipe(
      filter((event: RouterEvent): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      const currentUrl = event.urlAfterRedirects;
      this.showBackButton = (currentUrl !== '/dashboard' && currentUrl !== '/');
      // console.log('Current URL:', currentUrl, 'Show Back Button:', this.showBackButton);
    });
  }

  ngOnDestroy(): void {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }

  goBack(): void {
    this.location.back(); 
  }
}