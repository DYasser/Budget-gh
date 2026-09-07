// Karma configuration.
//
// The Angular CLI supplies working defaults, so this file exists for one reason: to
// define a headless launcher that works inside a CI container, where Chrome cannot
// use its sandbox and there is no /dev/shm worth speaking of.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false, // leave the Jasmine spec runner output visible in the browser
    },
    jasmineHtmlReporter: {
      suppressAll: true, // collapse duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/budget-io'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      // Used by `npm run test:ci`. --no-sandbox is required because CI runners execute
      // as root in a container; --disable-dev-shm-usage avoids crashes from the small
      // /dev/shm those containers ship with.
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    },
    restartOnFileChange: true,
  });
};
