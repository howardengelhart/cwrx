# Player Service Changelog

### 1.0.0: Mon Oct 26 09:08:08 EDT 2015
* [FEATURE]: Add [GET /api/public/players/:type] endpoint to return a
  bootstrappable MiniReel Player with ads
* Allow player code cache to be reset via a POSIX signal (SIGUSR2):
  [#586](https://github.com/cinema6/cwrx/issues/586)
* [FIX]: Player service no longer triggers alerts when it is
  intentionally restarted: [#587](https://github.com/cinema6/cwrx/issues/587)
* [FEATURE]: Inline branding stylesheets: [#584](https://github.com/cinema6/cwrx/issues/584)
