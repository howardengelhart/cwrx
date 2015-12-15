(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        express         = require('express'),
        campaignUtils   = require('../lib/campaignUtils'),
        requestUtils    = require('../lib/requestUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        enums           = require('../lib/enums'),
        
        campModule = { config: {} };
        
    campModule.campSchema = {
        status: {
            __allowed: false,
            __type: 'string',
            __default: enums.Status.Draft,
            __acceptableValues: Object.keys(enums.Status).map(function(key) {
                return enums.Status[key];
            })
        },
        application: {
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __default: 'studio'
        },
        advertiserId: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        paymentMethod: {
            __allowed: true,
            __type: 'string'
        },
        updateRequest: {
            __allowed: false,
            __type: 'string'
        },
        rejectionReason: {
            __allowed: false,
            __type: 'string'
        },
        minViewTime: {
            __allowed: false,
            __type: 'number'
        },
        pricing: {
            budget: {
                __allowed: true,
                __type: 'number',
                __min: 50,
                __max: 20000
            },
            dailyLimit: {
                __allowed: true,
                __type: 'number',
                __percentMin: 0.015,    // used internally, not in model.validate()
                __percentMax: 1,        // used internally, not in model.validate()
                __percentDefault: 1.00  // used internally, not in model.validate()
            },
            model: {
                __allowed: false,
                __type: 'string',
                __default: 'cpv'
            },
            cost: {
                __allowed: false,
                __type: 'number',
                __base: 0.05,               // starting cpv; these props not used in model.validate
                __pricePerGeo: 0,               // add-on price for each geo subcategory
                __pricePerDemo: 0,              // add-on price for each demo subcategory
                __priceForGeoTargeting: 0.01,   // add-on price if any demo subcategories are set
                __priceForDemoTargeting: 0.01,  // add-on price if any demo subcategories are set
                __priceForInterests: 0.01       // add-on price if any interests set
            }
        },
        pricingHistory: {
            __allowed: false,
            __type: 'objectArray',
            __locked: true
        },
        targeting: {
            __allowed: true,
            geo: {
                __allowed: true,
                states: {
                    __allowed: true,
                    __type: 'stringArray'
                },
                dmas: {
                    __allowed: true,
                    __type: 'stringArray'
                }
            },
            demographics: {
                __allowed: true,
                gender: {
                    __allowed: true,
                    __type: 'stringArray'
                },
                age: {
                    __allowed: true,
                    __type: 'stringArray'
                },
                income: {
                    __allowed: true,
                    __type: 'stringArray'
                }
            },
            interests: {
                __allowed: true,
                __type: 'stringArray'
            }
        },
        staticCardMap: {
            __allowed: false,
            __type: 'object'
        },
        cards: {
            __allowed: true,
            __type: 'objectArray',
            __length: 1
        },
        miniReels: {
            __allowed: false,
            __type: 'objectArray'
        }
    };

    campModule.setupSvc = function(db, config) {
        campModule.config.api = config.api;
        Object.keys(campModule.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            campModule.config.api[key].baseUrl = urlUtils.resolve(
                campModule.config.api.root,
                campModule.config.api[key].endpoint
            );
        });
    
        var campColl = db.collection('campaigns'),
            svc = new CrudSvc(campColl, 'cam', { statusHistory: true }, campModule.campSchema);
        svc._db = db;
        
        var extraValidation = campModule.extraValidation.bind(campModule, svc);
        
        svc.use('read', campModule.formatTextQuery);
        
        svc.use('create', campModule.fetchCards);
        svc.use('create', extraValidation);
        svc.use('create', campModule.defaultReportingId);
        svc.use('create', campModule.updateCards);
        svc.use('create', campModule.handlePricingHistory);

        svc.use('edit', campModule.statusCheck.bind(campModule, [enums.Status.Draft]));
        svc.use('edit', campModule.enforceLock);
        svc.use('edit', campModule.fetchCards);
        svc.use('edit', extraValidation);
        svc.use('edit', campModule.defaultReportingId);
        svc.use('edit', campModule.cleanCards);
        svc.use('edit', campModule.cleanMiniReels);
        svc.use('edit', campModule.updateCards);
        svc.use('edit', campModule.handlePricingHistory);

        svc.use('delete', campModule.statusCheck.bind(campModule, [
            enums.Status.Draft,
            enums.Status.Pending,
            enums.Status.Canceled,
            enums.Status.Expired
        ]));
        svc.use('delete', campModule.fetchCards);
        svc.use('delete', campModule.deleteContent);

        return svc;
    };
    
    // Replace entries in cards array with fetched C6 cards. Should be called just before response
    campModule.decorateWithCards = function(req, campResp) {
        var log = logger.getLog(),
            cardIds = [],
            fetchFailed = false;
            
        req._cards = req._cards || {};
        
        if (campResp.code < 200 || campResp.code >= 300 || typeof campResp.body !== 'object') {
            return q(campResp);
        }
        
        // Fetch list of cards through GET /api/content/cards?ids=...
        function fetchCards(ids) {
            if (ids.length === 0) {
                return q();
            }
        
            log.trace('[%1] Decorating campaigns, fetching cards [%2]', req.uuid, ids);
            return requestUtils.qRequest('get', {
                url: campModule.config.api.cards.baseUrl,
                qs: { ids: ids.join(',') },
                headers: { cookie: req.headers.cookie }
            })
            .then(function(resp) {
                if (resp.response.statusCode !== 200) {
                    log.warn('[%1] Could not fetch cards to decorate campaigns for user %2: %3, %4',
                             req.uuid, req.user.id, resp.response.statusCode, resp.body);
                    fetchFailed = true;
                    return;
                }
                
                resp.body.forEach(function(card) {
                    req._cards[card.id] = card;
                });
            })
            .catch(function(error) {
                log.error('[%1] Failed to fetch cards for user %2: %3',
                          req.uuid, req.user.id, util.inspect(error));
                return q.reject('Error fetching cards');
            });
        }
        
        // Get list of cards that need to be fetched, ignoring anything already in req._cards
        var camps = (campResp.body instanceof Array ? campResp.body : [campResp.body]);
        camps.forEach(function(camp) {
            var toFetch = (camp.cards || [])
            .map(function(card) { return card.id; })
            .filter(function(id) { return !!id && !req._cards[id]; });

            cardIds = cardIds.concat(toFetch);
        });
        
        return fetchCards(cardIds).then(function() {
            camps.forEach(function(camp) {
                if (!camp.cards) {
                    return;
                }
                
                camp.cards = camp.cards.map(function(cardEntry) {
                    // warn if a card not fetched, unless already warned b/c fetch failed
                    if (!req._cards[cardEntry.id] && !fetchFailed) {
                        log.warn('[%1] Card %2 not fetched', req.uuid, cardEntry.id);
                    }
                    
                    return req._cards[cardEntry.id] || cardEntry;
                });
            });
            
            return q(campResp);
        });
    };
    
    
    // Format a 'text search' query: currently just turns it into a regex query on name field
    campModule.formatTextQuery = function(req, next/*, done*/) {
        if (!req._query || !req._query.text) {
            return next();
        }
        
        var textParts = req._query.text.trim().split(/\s+/),
            regexQuery = { $regex: '.*' + textParts.join('.*') + '.*', $options: 'i' },
            orClause = { $or: [ { name: regexQuery }, { advertiserDisplayName: regexQuery } ] };
        
        mongoUtils.mergeORQuery(req._query, orClause);
        delete req._query.text;

        return next();
    };

    // Check and 400 if req.origObj.status is not one of the statuses in permitted
    campModule.statusCheck = function(permitted, req, next, done) {
        var log = logger.getLog();

        if (permitted.indexOf(req.origObj.status) !== -1 ||
            !!req.user.entitlements.directEditCampaigns) {
            return q(next());
        } else {
            log.info('[%1] This action not permitted on %2 campaign', req.uuid, req.origObj.status);
            return q(done({
                code: 400,
                body: 'Action not permitted on ' + req.origObj.status + ' campaign'
            }));
        }
    };
    
    // Prevent editing a campaign that has an updateRequest property
    campModule.enforceLock = function(req, next, done) {
        var log = logger.getLog();
        
        if (req.origObj && !!req.origObj.updateRequest) {
            log.info('[%1] Campaign %2 has pending update request %3, cannot edit',
                     req.uuid, req.origObj.id, req.origObj.updateRequest);
            return done({
                code: 400,
                body: 'Campaign locked until existing update request resolved'
            });
        }
        
        return next();
    };

    /* Fetch cards defined in req.body.cards + req.origObj.cards from content svc. Stores entities
     * in req._cards + req._origCards, respectively. */
    campModule.fetchCards = function(req, next, done) {
        var log = logger.getLog(),
            doneCalled = false,
            reqCache = {};
            
        req._cards = {};
        req._origCards = {};
        
        // cache request promises to avoid making duplicate requests
        function makeRequest(id) {
            reqCache[id] = reqCache[id] || requestUtils.qRequest('get', {
                url: urlUtils.resolve(campModule.config.api.cards.baseUrl, id),
                headers: { cookie: req.headers.cookie }
            })
            .catch(function(error) {
                log.error('[%1] Failed to fetch card %2 for user %3: %4',
                          req.uuid, id, req.user.id, util.inspect(error));
                return q.reject(new Error('Error fetching card ' + id));
            });
            
            return reqCache[id];
        }
        
        return q.all((req.body.cards || []).map(function(newCard) {
            if (!newCard.id) {
                return q();
            }

            return makeRequest(newCard.id).then(function(resp) {
                if (resp.response.statusCode === 200) {
                    req._cards[newCard.id] = resp.body;
                    return;
                }
                
                // Return 400 if card in req.body.cards cannot be fetched
                log.info('[%1] Could not fetch card %2 from req.body for user %3: %4, %5',
                         req.uuid, newCard.id, req.user.id, resp.response.statusCode, resp.body);
                
                if (!doneCalled) {
                    doneCalled = true;
                    return done({ code: 400, body: 'Cannot fetch card ' + newCard.id });
                }
            });
        })
        .concat(((req.origObj && req.origObj.cards) || []).map(function(oldCard) {
            return makeRequest(oldCard.id).then(function(resp) {
                if (resp.response.statusCode === 200) {
                    req._origCards[oldCard.id] = resp.body;

                    objUtils.extend(oldCard, resp.body);
                    return;
                }

                // Warn, but continue, if card in existing campaign can't be fetched for user
                log.warn('[%1] Could not fetch card %2 from req.origObj for user %3: %4, %5',
                         req.uuid, oldCard.id, req.user.id, resp.response.statusCode, resp.body);
            });
        })))
        .then(function() {
            if (!doneCalled) {
                log.trace('[%1] Fetched all cards for campaign', req.uuid);
                next();
            }
        });
    };
    
    // Additional validation for cards array + pricing not covered by model; may mutate body
    campModule.extraValidation = function(svc, req, next, done) {
        var log = logger.getLog();
        
        var validResps = [
            campaignUtils.ensureUniqueIds(req.body),
            campaignUtils.validateAllDates(req.body, req.origObj, req.user, req.uuid),
            campaignUtils.validatePricing(req.body, req.origObj, req.user, svc.model),
        ];
        
        for (var i = 0; i < validResps.length; i++) {
            if (!validResps[i].isValid) {
                log.info('[%1] %2', req.uuid, validResps[i].reason);
                return q(done({ code: 400, body: validResps[i].reason }));
            }
        }
        
        return campaignUtils.validatePaymentMethod(
            req.body,
            req.origObj,
            req.user,
            campModule.config.api.paymentMethods.baseUrl,
            req
        )
        .then(function(validResp) {
            if (!validResp.isValid) {
                log.info('[%1] %2', req.uuid, validResp.reason);
                return done({ code: 400, body: validResp.reason });
            } else {
                return next();
            }
        });
    };
    
    // Set the reportingId for each card without one to the campaign's name
    campModule.defaultReportingId = function(req, next/*, done*/) {
        if (!req.body.cards) {
            return next();
        }
        
        req.body.cards.forEach(function(card) {
            if (card.campaign && !card.campaign.reportingId) {
                card.campaign.reportingId = req.body.name || (req.origObj && req.origObj.name);
            }
        });
        
        return next();
    };

    // Remove entries from the staticCardMap for deleted sponsored cards
    campModule.cleanStaticMap = function(req, toDelete) {
        var map = req.body.staticCardMap = req.body.staticCardMap ||
                  (req.origObj && req.origObj.staticCardMap) || undefined;
        
        if (!toDelete || !(map instanceof Object)) {
            return;
        }
        
        Object.keys(map).forEach(function(expId) {
            if (!(map[expId] instanceof Object)) {
                return;
            }
            
            Object.keys(map[expId]).forEach(function(plId) {
                if (toDelete.indexOf(map[expId][plId]) !== -1) {
                    delete map[expId][plId];
                }
            });
        });
    };
    
    /* Send a DELETE request to the content service. type should be "card" or "experience"
     * Logs + swallows 4xx failures, but rejects 5xx failures. */
    campModule.sendDeleteRequest = function(req, id, type) {
        var log = logger.getLog();
        
        return requestUtils.qRequest('delete', {
            url: urlUtils.resolve(campModule.config.api[type].baseUrl, id),
            headers: { cookie: req.headers.cookie }
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 204) {
                log.warn('[%1] Could not delete %2 %3. Received (%4, %5)',
                         req.uuid, type, id, resp.response.statusCode, resp.body);
            } else {
                log.info('[%1] Succesfully deleted %2 %3', req.uuid, type, id);
            }
        })
        .catch(function(error) {
            log.error('[%1] Error deleting %2 %3: %4', req.uuid, type, id, util.inspect(error));
            return q.reject(new Error('Failed sending delete request to content service'));
        });
    };

    /* Middleware to delete unused sponsored cards and cards. Also calls cleanStaticMap() */
    campModule.cleanCards = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            toDelete = [];
        
        if (!req.origObj || !req.origObj.cards || !req.body.cards) {
            return q(next());
        }
        
        return q.all(req.origObj.cards.map(function(oldEntry) {
            if (!!req._cards[oldEntry.id]) {
                log.trace('[%1] Campaign for %2 still exists for %3', req.uuid, oldEntry.id, id);
                return q();
            }
            
            var oldCard = req._origCards[oldEntry.id];
                
            if (!oldCard) {
                log.info('[%1] Card %2 not fetched, so not deleting it', req.uuid, oldEntry.id);
                return q();
            }
            
            log.info('[%1] Card %2 removed from %3, deleting it', req.uuid, oldEntry.id, id);
            toDelete.push(oldEntry.id);
            return campModule.sendDeleteRequest(req, oldEntry.id, 'cards');
        }))
        .then(function() {
            log.trace('[%1] Deleted all unused cards for %2', req.uuid, id);
            campModule.cleanStaticMap(req, toDelete);
            next();
        });
    };
    
    // Delete unused sponsored miniReels by proxying DELETE requests to content svc
    campModule.cleanMiniReels = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id);
        
        if (!req.origObj || !req.origObj.miniReels || !req.body.miniReels) {
            return q(next());
        }
        
        return q.all(req.origObj.miniReels.map(function(oldEntry) {
            if (req.body.miniReels.some(function(newObj) { return newObj.id === oldEntry.id; })) {
                log.trace('[%1] Minireel %2 still exists for %3', req.uuid, oldEntry.id, id);
                return q();
            }
        
            return campModule.sendDeleteRequest(req, oldEntry.id, 'experiences');
        }))
        .then(function() {
            log.trace('[%1] Deleted all unused minireels for %2', req.uuid, id);
            next();
        });
    };
    
    /* For each entry in req.body.cards, create/edit the card through the content service.
     * Saves updated card to req._cards, and replaces entry in array with { id: 'rc-...' } */
    campModule.updateCards = function(req, next, done) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            advertiserId = req.body.advertiserId || (req.origObj && req.origObj.advertiserId),
            doneCalled = false;
        
        if (!req.body.cards) {
            return q(next());
        }
        
        return q.all(req.body.cards.map(function(cardEntry, idx) {
            var opts = {
                json: cardEntry,
                headers: { cookie: req.headers.cookie }
            },
            identifier = cardEntry.id || '"' + cardEntry.title + '"',
            verb, expectedResponse;

            if (!cardEntry.id) {
                verb = 'post';
                opts.url = campModule.config.api.cards.baseUrl;
                expectedResponse = 201;
            } else {
                verb = 'put';
                opts.url = urlUtils.resolve(campModule.config.api.cards.baseUrl, cardEntry.id);
                expectedResponse = 200;
            }
            cardEntry.campaignId = id;
            cardEntry.advertiserId = advertiserId;
            
            return requestUtils.qRequest(verb, opts)
            .then(function(resp) {
                if (resp.response.statusCode !== expectedResponse) {
                    log.info(
                        '[%1] Failed to %2 card %3 for user %4: %5, %6',
                        req.uuid,
                        verb,
                        identifier,
                        req.user.id,
                        resp.response.statusCode,
                        resp.body
                    );
                    if (!doneCalled) {
                        doneCalled = true;
                        return done({ code: 400, body: 'Cannot ' + verb + ' card ' + identifier });
                    }
                    return;
                }

                log.info('[%1] Successfully %2 card %3 for user %4',
                         req.uuid, verb, resp.body.id, req.user.id);
                
                // save full body to req._cards, format array entry to just obj w/ id
                req._cards[resp.body.id] = resp.body;
                req.body.cards[idx] = { id: resp.body.id };
            })
            .catch(function(error) {
                log.error('[%1] Failed to %2 card %3 for user %4: %5',
                          req.uuid, verb, identifier, req.user.id, util.inspect(error));
                return q.reject(new Error('Error updating card ' + identifier));
            });
        }))
        .then(function() {
            if (!doneCalled) {
                log.trace('[%1] Finished creating/updating cards for %2', req.uuid, id);
                next();
            }
        });
    };
    
    // Initialize or update the pricingHistory property when the pricing changes
    campModule.handlePricingHistory = function(req, next/*, done*/) {
        var orig = req.origObj || {},
            status = req.body.status || orig.status;
        
        delete req.body.pricingHistory;
            
        if (req.body.pricing && !objUtils.compareObjects(req.body.pricing, orig.pricing)) {
            req.body.pricingHistory = orig.pricingHistory || [];
            
            var wrapper = {
                pricing : req.body.pricing,
                userId  : req.user.id,
                user    : req.user.email,
                date    : new Date()
            };
            
            if (status === enums.Status.Draft) {
                req.body.pricingHistory[0] = wrapper;
            } else {
                req.body.pricingHistory.unshift(wrapper);
            }
        }
        
        next();
    };

    // Middleware to delete all sponsored content associated with this to-be-deleted campaign
    campModule.deleteContent = function(req, next/*, done*/) {
        var log = logger.getLog();
            
        return q.all(
            (req.origObj.cards || []).map(function(card) {
                return campModule.sendDeleteRequest(req, card.id, 'cards');
            })
            .concat((req.origObj.miniReels || []).map(function(exp) {
                return campModule.sendDeleteRequest(req, exp.id, 'experiences');
            }))
        )
        .then(function() {
            log.trace('[%1] Successfully deleted content for campaign %2',req.uuid,req.origObj.id);
            next();
        });
    };

    
    campModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/campaigns?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetSchema = authUtils.middlewarify({});
        router.get('/schema', sessions, authGetSchema, function(req, res) {
            var promise = svc.getSchema(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving schema', detail: error });
                });
            });
        });

        var authGetCamp = authUtils.middlewarify({campaigns: 'read'});
        router.get('/:id', sessions, authGetCamp, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                return campModule.decorateWithCards(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaign', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCamp, audit, function(req, res) {
            var query = {};
            ['user', 'org', 'name', 'text', 'application']
            .forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });
            if ('statuses' in req.query) {
                query.status = String(req.query.statuses).split(',');
            }
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            if ('pendingUpdate' in req.query) {
                query.updateRequest = { $exists: req.query.pendingUpdate === 'true' };
            }

            var promise = svc.getObjs(query, req, true).then(function(resp) {
                return campModule.decorateWithCards(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaigns', detail: error });
                });
            });
        });

        var authPostCamp = authUtils.middlewarify({campaigns: 'create'});
        router.post('/', sessions, authPostCamp, audit, function(req, res) {
            var promise = svc.createObj(req).then(function(resp) {
                return campModule.decorateWithCards(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating campaign', detail: error });
                });
            });
        });

        var authPutCamp = authUtils.middlewarify({campaigns: 'edit'});
        router.put('/:id', sessions, authPutCamp, audit, function(req, res) {
            var promise = svc.editObj(req).then(function(resp) {
                return campModule.decorateWithCards(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating campaign', detail: error });
                });
            });
        });

        var authDelCamp = authUtils.middlewarify({campaigns: 'delete'});
        router.delete('/:id', sessions, authDelCamp, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting campaign', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = campModule;
}());
