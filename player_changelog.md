# Player Service Changelog

### 2.7.3: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* [FIX]: Log signal + exit code when worker dies unexpectedly: [#821](https://github.com/cinema6/cwrx/pull/821)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 2.7.2: Thu Mar  3 15:45:20 EST 2016
* Increase speed of initial player responses by pre-caching some common
  players when the service starts: [#808](https://github.com/cinema6/cwrx/pull/808)

### 2.7.1: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* Extra deployment steps: None

### 2.7.0: Thu Feb 18 11:49:08 EST 2016
* Add `{context}` macro to tracking pixels to track the UI element that
  generated the event: [#797](https://github.com/cinema6/cwrx/pull/797)
* Add `{screenWidth}`, `{screenHeight}`, `{playerWidth}`, and
  `{playerHeight}` macors to tracking pixels to track screen/player
  dimensions: [#797](https://github.com/cinema6/cwrx/pull/797)
* Add `interactionUrls` to cards to track internal interactions with the
  player: [#797](https://github.com/cinema6/cwrx/pull/797)
* Stop defaulting the `host` parameter in VAST impression pixels:
  [#797](https://github.com/cinema6/cwrx/pull/797)

### 2.6.0: Wed Feb 10 09:50:28 EST 2016
* Add support for [`domino.css`](https://github.com/cinema6/domino.css)
  with `branding`

### 2.5.1: Fri Feb  5 12:40:13 EST 2016
* [FIX]: Add tracking pixels to statically-mapped sponsored cards in a
  MiniReel: [#783](https://github.com/cinema6/cwrx/pull/783)

### 2.5.0: Fri Jan 29 15:27:18 EST 2016
* [FEATURE]: Add [GET /api/public/vast/2.0/tag] endpoint to return VAST
  documents: [#774](https://github.com/cinema6/cwrx/pull/774)
* [FIX]: Make sure CORS headers are set on VAST responses: [#776](https://github.com/cinema6/cwrx/pull/776)

### 2.4.0: Thu Jan 28 10:02:35 EST 2016
* Add `branding`, `ex` and `vr` query params to tracking pixel URLs:
  [#772](https://github.com/cinema6/cwrx/pull/772)

### 2.3.1: Wed Jan 27 13:05:33 EST 2016
* Remove pixel-tracking compatibility hacks: [#770](https://github.com/cinema6/cwrx/pull/770)

### 2.3.0: Tue Jan 26 15:01:40 EST 2016
* [FEATURE]: Add [GET /api/public/player] endpoint to return a player
  configured via a placement: [#756](https://github.com/cinema6/cwrx/pull/756)
* Move card tracking pixel insertion into this service: [#759](https://github.com/cinema6/cwrx/pull/759)
* [FEATURE]: Add session IDs (internal and external) to tracking pixel
  URLs: [#759](https://github.com/cinema6/cwrx/pull/759)
* [FIX]: Don't break if the request has no referer/origin:[#769](https://github.com/cinema6/cwrx/pull/769)

### 2.2.1: Thu Jan 21 10:53:29 EST 2016
* [FIX]: Log errors (and trigger PagerDuty alerts) when requests fail
  for unexpected reasons: [#753](https://github.com/cinema6/cwrx/pull/753)

### 2.2.0: Wed Jan 20 12:14:09 EST 2016
* [FEATURE]: Add support for third-party `clickUrls` that will be fired
  whenever a link click/share occurs: [#747](https://github.com/cinema6/cwrx/pull/747)

### 2.1.2: Thu Jan 14 13:51:41 EST 2016
* Add ability to create conditional player builds based on various
  attributes of the experience/card: [#735](https://github.com/cinema6/cwrx/pull/735)
* [FIX]: Stop triggering PagerDuty alerts if the request for a card
  `4xx`s: [#736](https://github.com/cinema6/cwrx/pull/736)

### 2.1.1: Thu Jan  7 16:30:36 EST 2016
* The player is now built dynamically at runtime: [#723](https://github.com/cinema6/cwrx/pull/723)
* Add support for debug (unminifed) player builds: [#725](https://github.com/cinema6/cwrx/pull/725)
* Make sure the host (request origin) is set by the content service in
  card pixel URLs: [#726](https://github.com/cinema6/cwrx/pull/726)
* Allow campaign ID to be specified with a card ID: [#727](https://github.com/cinema6/cwrx/pull/727/files)
* **Extra Deployment Steps**: [#724](https://github.com/cinema6/cwrx/issues/724)

### 2.1.0: Tue Dec 29 11:26:35 EST 2015
* Include provided options in response body: [#712](https://github.com/cinema6/cwrx/pull/712)
* Report player (front-end) version in the meta endpoint response:
  [#713](https://github.com/cinema6/cwrx/pull/713)

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
