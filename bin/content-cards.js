(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        path            = require('path'),
        express         = require('express'),
        querystring     = require('querystring'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        Status          = require('../lib/enums').Status,

        cardModule = { config: {} };
    
    cardModule.cardSchema = {
        campaignId: {
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __required: true
        },
        campaign: {
            __default: {},
            reportingId: {
                __allowed: true,
                __type: 'string'
            },
            minViewTime: {
                __allowed: false,
                __type: 'number',
                __default: 3
            },
            adtechName: {
                __allowed: true,
                __type: 'string'
            },
            startDate: {
                __allowed: true,
                __type: 'string'
            },
            endDate: {
                __allowed: true,
                __type: 'string'
            },
            adtechId: {
                __allowed: false,
                __type: 'number',
                __locked: true
            },
            bannerId: {
                __allowed: false,
                __type: 'number',
                __locked: true
            },
            bannerNumber: {
                __allowed: false,
                __type: 'number',
                __locked: true
            }
        },
        data: {
            __default: {},
            skip: {
                __allowed: false,
                __required: true,
                __default: 30
            },
            controls: {
                __allowed: false,
                __type: 'boolean',
                __required: true,
                __default: true
            },
            autoplay: {
                __allowed: false,
                __type: 'boolean',
                __required: true,
                __default: true
            },
            autoadvance: {
                __allowed: false,
                __type: 'boolean',
                __required: true,
                __default: false
            },
            moat: { // Ensures moat is set to {} for default user, subfields get set in setupMoat()
                __allowed: true,
                __type: 'object',
                __required: true,
                __default: {}
            }
        }
    };


    cardModule.setupSvc = function(db, config, caches, metagetta) {
        var log = logger.getLog();

        cardModule.config.trackingPixel = config.trackingPixel;

        if (!metagetta.hasGoogleKey) {
            log.warn('Missing googleKey from secrets, will not be able to lookup ' +
                'meta data for youtube videos.');
        }
        if (!metagetta.hasWistiaKey) {
            log.warn('Missing wistiaKey from secrets, will not be able to lookup ' +
                'meta data for wistia videos.');
        }
        if (!metagetta.hasJWKey) {
            log.warn('Missing jwKey from secrets, will not be able to lookup ' +
                'meta data for jwplayer videos.');
        }
        cardModule.metagetta = metagetta;
    
        var opts = { allowPublic: true },
            svc = new CrudSvc(db.collection('cards'), 'rc', opts, cardModule.cardSchema);
            
        svc._db = db;
        
        var fetchCamp = cardModule.fetchCamp.bind(cardModule, svc);
        
        svc.use('create', fetchCamp);
        svc.use('create', cardModule.getMetaData);
        svc.use('create', cardModule.setupMoat);

        svc.use('edit', fetchCamp);
        svc.use('edit', cardModule.campStatusCheck.bind(cardModule, [Status.Draft]));
        svc.use('edit', cardModule.enforceUpdateLock);
        svc.use('edit', cardModule.getMetaData);
        svc.use('edit', cardModule.setupMoat);
        
        svc.use('delete', fetchCamp);
        svc.use('delete', cardModule.campStatusCheck.bind(cardModule, [
            Status.Draft,
            Status.Pending,
            Status.Canceled,
            Status.Expired
        ]));
        
        svc.getPublicCard = cardModule.getPublicCard.bind(cardModule, svc, caches);
        
        return svc;
    };

    /* Middleware to fetch the (undecorated) campaign and attach it as req.campaign.
     * If campaign does not exist, log a message but proceed without req.campaign. */
    cardModule.fetchCamp = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            campId = req.body.campaignId || (req.origObj && req.origObj.campaignId);
            
        log.trace('[%1] Fetching campaign %2', req.uuid, String(campId));
        
        return q.npost(svc._db.collection('campaigns'), 'findOne', [
            { id: String(campId), status: { $ne: Status.Deleted } }
        ])
        .then(function(camp) {
            if (camp) {
                req.campaign = camp;
            } else if (req.method.toLowerCase() !== 'post') {
                log.warn('[%1] Campaign %2 not found or deleted', req.uuid, campId);
            }
            
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Failed to fetch campaign %2 from mongo: %3',
                      req.uuid, campId, util.inspect(error));
            return q.reject('Error fetching campaign');
        });
    };

    // Check and 400 if req.campaign.status is not one of the statuses in permitted
    cardModule.campStatusCheck = function(permitted, req, next, done) {
        var log = logger.getLog();

        if (!req.campaign || permitted.indexOf(req.campaign.status) !== -1 ||
                             !!req.user.entitlements.directEditCampaigns) {
            return next();
        } else {
            log.info('[%1] Action not permitted on %2 campaign', req.uuid, req.campaign.status);
            return done({
                code: 400,
                body: 'Action not permitted on ' + req.campaign.status + ' campaign'
            });
        }
    };

    // Prevent editing a card if its campaign has an updateRequest property
    cardModule.enforceUpdateLock = function(req, next, done) {
        var log = logger.getLog();
        
        if (req.campaign && !!req.campaign.updateRequest) {
            log.info('[%1] Campaign %2 has pending update request %3, cannot edit %4',
                     req.uuid, req.campaign.id, req.campaign.updateRequest, req.origObj.id);
            return done({
                code: 400,
                body: 'Campaign + cards locked until existing update request resolved'
            });
        }
        
        return next();
    };
    
    cardModule.isVideoCard = function(card) {
        return  (card.type === 'youtube') ||
                (card.type === 'adUnit')  ||
                (card.type === 'vimeo')   ||
                (card.type === 'dailymotion')  ||
                (card.type === 'vzaar')   ||
                (card.type === 'wistia')  ||
                (card.type === 'jwplayer')  ||
                ((card.type === 'instagram') && (card.data) && (card.data.type === 'video'));
    };

    cardModule.getMetaData = function(req, next /*, done */) {
        var log = logger.getLog(), opts = { };

        if (!cardModule.isVideoCard(req.body)){
            log.trace('[%1] - CardType [%2] is not a video card.',req.uuid,req.body.type);
            return q(next());
        }

        if (!req.body.data) {
            return q(next());
        }

        if (Object.keys(req.body.data).length === 0){
            return q(next());
        }
        
        if (req.origObj && req.origObj.data ) {
            if  (
                    (req.origObj.data.vast === req.body.data.vast) &&
                    (req.origObj.data.vpaid === req.body.data.vpaid) &&
                    (req.origObj.data.videoid === req.body.data.videoid) &&
                    (req.origObj.data.duration > -1) &&
                    (Date.now() - req.origObj.lastUpdated.valueOf() < 60000) ) {
                log.trace('[%1] - Video unchanged, no need to get metadata.',req.uuid);
                return q(next());
            }
        }

        if (req.body.data.vast) {
            opts.type = 'vast';
            opts.uri  = req.body.data.vast;
        } else
        if (req.body.data.vpaid) {
            opts.type = 'vast';
            opts.uri  = req.body.data.vpaid;
        } else
        if (req.body.type === 'youtube') {
            if (!cardModule.metagetta.hasGoogleKey) {
                req.body.data.duration = -1;
                log.warn('[%1] - Cannot get youtube duration without secrets.googleKey.',
                    req.uuid);
                return q(next());
            }
            opts.type = 'youtube';
            opts.id   = req.body.data.videoid;
        } else
        if (req.body.type === 'vimeo') {
            opts.type = 'vimeo';
            opts.id   = req.body.data.videoid;
        } else
        if (req.body.type === 'dailymotion') {
            opts.type = 'dailymotion';
            opts.id   = req.body.data.videoid;
        } else
        if(req.body.type === 'wistia') {
            if (!cardModule.metagetta.hasWistiaKey) {
                req.body.data.duration = -1;
                log.warn('[%1] - Cannot get wistia duration without secrets.wistiaKey.',
                    req.uuid);
                return q(next());
            }
            opts.uri = req.body.data.href;
        } else
        if (req.body.type === 'jwplayer') {
            if (!cardModule.metagetta.hasJWKey) {
                req.body.data.duration = -1;
                log.warn('[%1] - Cannot get jwplayer duration without secrets.jwKey or ' +
                    'secrets.jwSecret.', req.uuid);
                return q(next());
            }
            opts.type = 'jwplayer';
            opts.id   = req.body.data.videoid.split('-')[0];
        } else
        if (req.body.type === 'vzaar') {
            opts.type = 'vzaar';
            opts.id   = req.body.data.videoid;
        } else {
            req.body.data.duration = -1;
            log.info('[%1] - MetaData unsupported for CardType [%2].',req.uuid,req.body.type);
            return q(next());
        }

        if ((opts.uri) && (opts.uri.match(/^\/\//))) {
            opts.uri = 'http:' + opts.uri;
        }

        return cardModule.metagetta(opts)
        .then(function(res){
            if ((res.duration === null) || (res.duration === undefined)){
                return q.reject(new Error('Missing duration for the specified resource.'));
            }
            req.body.data.duration = res.duration;
            log.trace('[%1] - setting duration to [%2]',req.uuid,res.duration);
            return next();
        })
        .catch(function(err){
            delete opts.youtube;
            delete opts.wistia;
            delete opts.jwplayer;
            req.body.data.duration = -1;
            log.warn('[%1] - [%2] [%3]', req.uuid, err.message, JSON.stringify(opts));
            return next();
        });
    };

    // Setup the data.moat object on the card, if data and data.moat are defined.
    cardModule.setupMoat = function(req, next/*, done*/) {
        var id = req.body.id || (req.origObj && req.origObj.id),
            campaignId = req.body.campaignId || (req.origObj && req.origObj.campaignId),
            advertiserId = req.body.advertiserId || (req.origObj && req.origObj.advertiserId);
        
        if (!req.body.data || !req.body.data.moat) {
            return next();
        }
        
        req.body.data.moat = {
            campaign: campaignId,
            advertiser: advertiserId,
            creative: id
        };
        
        return next();
    };


    // Format a tracking pixel link, pulling data from query params.
    cardModule.formatUrl = function(card, req, event) {
        req.query = req.query || {};
        
        // get experience id from path if request for experience; else from query param
        var expId = (/experience/.test(path.join(req.baseUrl, req.route.path)) && req.params.id) ||
                    req.query.experience || '';

        var qps = {
            campaign    : card.campaignId,
            card        : card.id,
            experience  : expId,
            container   : req.query.container,
            host        : req.query.pageUrl || req.originHost,
            hostApp     : req.query.hostApp,
            network     : req.query.network,
            event       : event
        };
        
        var url = cardModule.config.trackingPixel + '?' + querystring.stringify(qps) +
                                                          '&cb={cachebreaker}';
                                                          
        if (event === 'play') {
            url += '&pd={playDelay}';
        } else if (event === 'load') {
            url += '&ld={loadDelay}';
        }
        
        return url;
    };
    
    // Adds tracking pixels to card.campaign, initializing arrays if needed
    cardModule.setupTrackingPixels = function(card, req) {
        card.campaign = card.campaign || {};

        function ensureList(prop) {
            return card.campaign[prop] || (card.campaign[prop] = []);
        }
        
        ensureList('viewUrls').push(cardModule.formatUrl(card, req, 'cardView'));
        ensureList('playUrls').push(cardModule.formatUrl(card, req, 'play'));
        ensureList('loadUrls').push(cardModule.formatUrl(card, req, 'load'));
        ensureList('countUrls').push(cardModule.formatUrl(card, req, 'completedView'));
        ensureList('q1Urls').push(cardModule.formatUrl(card, req, 'q1'));
        ensureList('q2Urls').push(cardModule.formatUrl(card, req, 'q2'));
        ensureList('q3Urls').push(cardModule.formatUrl(card, req, 'q3'));
        ensureList('q4Urls').push(cardModule.formatUrl(card, req, 'q4'));
        
        ['links', 'shareLinks'].forEach(function(prop) {
            if (typeof card[prop] !== 'object') {
                return;
            }
            
            var singular = prop.replace(/s$/, '');
            
            
            Object.keys(card[prop]).forEach(function(linkName) {
                var origVal = card[prop][linkName];

                if (typeof origVal === 'string') {
                    card[prop][linkName] = {
                        uri: origVal,
                        tracking: []
                    };
                } else {
                    card[prop][linkName].tracking = card[prop][linkName].tracking || [];
                }
                
                var pixelUrl = cardModule.formatUrl(card, req, singular + '.' + linkName);
                card[prop][linkName].tracking.push(pixelUrl);
            });
        });
    };

    // Get a card, using internal cache. Can be used across modules when 1st two args bound in
    cardModule.getPublicCard = function(cardSvc, caches, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'];

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return caches.cards.getPromise({ id: id })
        .spread(function(card) {
            // only show active cards
            if (!card || card.status !== Status.Active) {
                return q();
            }
            
            log.info('[%1] Retrieved card %2', req.uuid, id);
            
            privateFields.forEach(function(key) { delete card[key]; });
            card = cardSvc.formatOutput(card);
            card.campaign = card.campaign || {};

            if (req.query.preview !== 'true') {
                cardModule.setupTrackingPixels(card, req);
            }

            // fetch card's campaign so important props can be copied over
            return caches.campaigns.getPromise({ id: card.campaignId })
            .spread(function(camp) {
                if (!camp) {
                    log.warn('[%1] Campaign %2 not found for card %3',
                             req.uuid, card.campaignId, card.id);
                    return q();
                }

                // don't show card if campaign is canceled, expired, or deleted
                if ([Status.Canceled, Status.Expired, Status.Deleted].indexOf(camp.status) !== -1) {
                    log.info('[%1] Campaign %2 is %3, not showing card',
                             req.uuid, camp.id, camp.status);
                    return q();
                }
                
                card.advertiserId = camp.advertiserId;
                card.params = card.params || {};
                card.campaign = card.campaign || {};
                card.params.sponsor = camp.advertiserDisplayName || card.params.sponsor;
                
                var campEntry = (camp.cards || []).filter(function(cardObj) {
                    return cardObj.id === card.id;
                })[0] || {};

                card.adtechId = card.campaign.adtechId || campEntry.adtechId;
                card.bannerId = card.campaign.bannerNumber || campEntry.bannerNumber;

                // don't show card without an adtechId
                if (!card.adtechId) {
                    log.warn('[%1] No adtechId for %2 in cards list of %3',
                             req.uuid, card.id, camp.id);
                    return q();
                }
                
                return card;
            });
        })
        .catch(function(error) {
            log.error('[%1] Error getting card %2: %3', req.uuid, id, error);
            return q.reject('Mongo error');
        });
    };
    
    // Handle requests for cards from /api/public/content/card/:id endpoints
    cardModule.handlePublicGet = function(req, res, cardSvc, config) {
        return cardSvc.getPublicCard(req.params.id, req)
        .then(function(card) {
            // don't cache for requests in preview mode
            if (!req.query.preview) {
                res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
            }
            
            if (!card) {
                return q({ code: 404, body: 'Card not found' });
            }
            
            // if ext === 'js', return card as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(card) + ';' });
            } else {
                return q({ code: 200, body: card });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving card', detail: error }});
        });
    };

    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit, config, jobManager) {
        // Public get card; regex at end allows client to optionally specify extension (js|json)
        app.get('/api/public/content/cards?/:id([^.]+).?:ext?', function(req, res) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });


        // Setup router for non-public card endpoints
        var router      = express.Router(),
            mountPath   = '/api/content/cards?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetSchema = authUtils.middlewarify({});
        router.get('/schema', sessions, authGetSchema, function(req, res) {
            var promise = cardSvc.getSchema(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving schema', detail: error });
                });
            });
        });

        var authGetCard = authUtils.middlewarify({cards: 'read'});
        router.get('/:id', sessions, authGetCard, audit, function(req, res) {
            var promise = cardSvc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving card', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCard, audit, function(req, res) {
            var query = {};
            ['org', 'user', 'campaignId'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }

            var promise = cardSvc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving cards', detail: error });
                });
            });
        });

        var authPostCard = authUtils.middlewarify({cards: 'create'});
        router.post('/', sessions, authPostCard, audit, function(req, res) {
            var promise = cardSvc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating card', detail: error });
                });
            });
        });

        var authPutCard = authUtils.middlewarify({cards: 'edit'});
        router.put('/:id', sessions, authPutCard, audit, function(req, res) {
            var promise = cardSvc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating card', detail: error });
                });
            });
        });

        var authDelCard = authUtils.middlewarify({cards: 'delete'});
        router.delete('/:id', sessions, authDelCard, audit, function(req, res) {
            var promise = cardSvc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting card', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };
    
    module.exports = cardModule;
}());
