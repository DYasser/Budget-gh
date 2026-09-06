import { Component, HostListener, ElementRef, HostBinding, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.css']
})
export class FooterComponent implements OnInit {
  currentYear: number = new Date().getFullYear();
  appVersion = '1.0.0'; // Or your actual app version

  // HostBinding applies a class to the host element (<app-footer>)
  @HostBinding('class.is-near-bottom') isNearBottom = false;

  constructor(private el: ElementRef) {} // Inject ElementRef to reference the host element

  // Listen for scroll events on the window
  @HostListener('window:scroll')
  checkScroll() {
    const componentPosition = this.el.nativeElement.offsetTop;
    const scrollPosition = window.pageYOffset + window.innerHeight;
    // Threshold: How close to the footer appearing should trigger the effect?
    // Adjust this value as needed. Smaller value means scrolling closer.
    const threshold = 100; // pixels

    // Check if the bottom of the viewport is near or past the top of the footer element
    // Or check if scrolled to the very bottom of the document
    const isNear = scrollPosition > componentPosition - threshold;
    const atBottom = (window.innerHeight + window.pageYOffset) >= document.body.offsetHeight - 2; // -2 for tolerance

    this.isNearBottom = isNear || atBottom;
  }

  // Optional: Run check once on load in case the page is too short to scroll
  ngOnInit() {
    setTimeout(() => this.checkScroll(), 0);
  }
}