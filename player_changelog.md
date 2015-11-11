# Player Service Changelog

* [FEATURE]: `card`/`experience`/`campaign`/`categories` can be
  specified for a request (`experience` is not required.)
* **Extra Deployment Steps**
  * Create the system experience in staging/production mongo

### 1.0.1: Mon Oct 26 09:08:08 EDT 2015
* Stop triggering warnings when an experience is loaded with no
  wildCardPlacement

### 1.0.0: Mon Oct 26 09:08:08 EDT 2015
* [FEATURE]: Add [GET /api/public/players/:type] endpoint to return a
  bootstrappable MiniReel Player with ads
* Allow player code cache to be reset via a POSIX signal (SIGUSR2):
  [#586](https://github.com/cinema6/cwrx/issues/586)
* [FIX]: Player service no longer triggers alerts when it is
  intentionally restarted: [#587](https://github.com/cinema6/cwrx/issues/587)
* [FEATURE]: Inline branding stylesheets: [#584](https://github.com/cinema6/cwrx/issues/584)
* Bypass card/experience caching in preview mode: [#599](https://github.com/cinema6/cwrx/issues/599)
* Send `preview` param to the content service: [#599](https://github.com/cinema6/cwrx/issues/599)
