# Player Service Changelog

### 2.0.1: Fri Dec 18 13:08:40 EST 2015
* [FIX]: Stop calling the content service for random cards if there are
  no placeholders to be filled: [#711](https://github.com/cinema6/cwrx/pull/711)

### 2.0.0: Thu Dec 17 16:44:26 EST 2015
* Remove calls to ADECH: [#709](https://github.com/cinema6/cwrx/pull/709)
* [REMOVAL]: Remove the ability to look-up sponsored cards by
  categories: [#709](https://github.com/cinema6/cwrx/pull/709)

### 1.5.0: Thu Dec 17 10:17:39 EST 2015
* [FEATURE]: Support overriding the skip settings of sponsored cards
  with the `skip` query param: [#707](https://github.com/cinema6/cwrx/pull/707)

### 1.4.0: Mon Dec 14 13:40:01 EST 2015
* Allow a player to be fetched without a creative (experience/card) if
  embed mode is enabled: [#702](https://github.com/cinema6/cwrx/pull/702)
* Make sure the branding param is respected when delivering a player with no
  experience: [#705](https://github.com/cinema6/cwrx/pull/705)

### 1.3.0: Mon Dec  7 16:37:44 EST 2015
* Allow a player to be fetched without a creative (experience/card) if
  standalone mode is enabled: [#676](https://github.com/cinema6/cwrx/pull/676)
* Allow the first card to be preloaded when delivering an MRAID unit:
  [#690](https://github.com/cinema6/cwrx/pull/690)

### 1.2.0: Mon Nov 30 11:02:27 EST 2015
* Redirect deprecated player requests to their maintained peers.

### 1.1.1: Thu Nov 19 17:12:16 EST 2015
* Disabled preloading of the first card when the context is mraid
* Ensure player base tag protocol matches the protocol of the page

### 1.1.0: Wed Nov 11 15:20:45 EST 2015
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
