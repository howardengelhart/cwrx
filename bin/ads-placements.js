(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        path            = require('path'),
        ld              = require('lodash'),
        express         = require('express'),
        fs              = require('fs-extra'),
        querystring     = require('querystring'),
        url             = require('url'),
        logger          = require('../lib/logger'),
        historian       = require('../lib/historian'),
        QueryCache      = require('../lib/queryCache'),
        Status          = require('../lib/enums').Status,
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),

        placeModule = { config: {} };
    
    placeModule.placeSchema = {
        label: {
            __allowed: true,
            __type: 'string'
        },
        tagType: {
            __allowed: true,
            __type: 'string'
        },
        startDate: {
            __allowed: true,
            __type: 'Date'
        },
        endDate: {
            __allowed: true,
            __type: 'Date'
        },
        budget: {
            daily: {
                __allowed: true,
                __type: 'number'
            },
            total: {
                __allowed: true,
                __type: 'number'
            }
        },
        externalCost: {
            event: {
                __allowed: true,
                __type: 'string'
            },
            cost: {
                __allowed: true,
                __type: 'number'
            }
        },
        costHistory: {
            __allowed: false,
            __type: 'objectArray',
            __locked: true
        },
        beeswaxIds: {
            __allowed: false,
            __type: 'object'
        },
        tagParams: {
            __type: 'object',
            __required: true,
            type: {
                __type: 'string',
                __allowed: true,
                __required: true
            },
            container: {
                __type: 'string',
                __allowed: true,
                __required: true
            },
            campaign: {
                __type: 'string',
                __allowed: true,
                __required: true
            },
            experience: {
                __allowed: true,
                __type: 'string'
            },
            card: {
                __allowed: true,
                __type: 'string'
            }
        },
        showInTag: {
            __type: 'object',
            __default: {},
            __required: true
        }
    };

    placeModule.setupSvc = function(db, config, beeswax) {
        placeModule.config.cacheTTLs = config.cacheTTLs;
        placeModule.config.beeswax = config.beeswax;
    
        var svc = new CrudSvc(db.collection('placements'), 'pl', {}, placeModule.placeSchema);
        svc._db = db;
        
        var validateExtRefs = placeModule.validateExtRefs.bind(placeModule, svc),
            costHistory     = historian.middlewarify('externalCost', 'costHistory');
        
        svc.use('create', validateExtRefs);
        svc.use('create', costHistory);
        svc.use('create', placeModule.createBeeswaxCreative.bind(placeModule, beeswax));

        svc.use('edit', validateExtRefs);
        svc.use('edit', costHistory);
        svc.use('edit', placeModule.editBeeswaxCreative.bind(placeModule, beeswax));
        
        var cache = new QueryCache(
            config.cacheTTLs.placements.freshTTL,
            config.cacheTTLs.placements.maxTTL,
            db.collection('placements')
        );
        svc.getPublicPlacement = placeModule.getPublicPlacement.bind(placeModule, svc, cache);
        
        return svc;
    };

    
    // Check that references to other C6 objects in tagParams hash are valid
    placeModule.validateExtRefs = function(svc, req, next, done) {
        var log = logger.getLog(),
            doneCalled = false;
        
        function checkExistence(prop, query, propPath) {
            // pass check w/o querying mongo if prop doesn't exist
            if (!ld.get(req, propPath, null)) {
                return q();
            }
            
            log.trace('[%1] Fetching %2 %3', req.uuid, prop, ld.get(req, propPath, null));
            
            return mongoUtils.findObject(svc._db.collection(prop + 's'), query)
            .then(function(obj) {
                if (!!obj) {
                    req[prop] = obj;
                    return;
                }

                var msg = util.format('%s %s not found', prop, req.body.tagParams[prop]);
                log.info('[%1] %2 with query %3, not saving placement',
                         req.uuid, msg, util.inspect(query));

                if (!doneCalled) {
                    doneCalled = true;
                    done({ code: 400, body: msg });
                }
            })
            .catch(function(error) {
                log.error('[%1] Error counting %2s: %3', req.uuid, prop, util.inspect(error));
                return q.reject(new Error('Mongo error'));
            });
        }
        
        var campFinished = [Status.Deleted, Status.Canceled, Status.Expired, Status.OutOfBudget];
        
        return q.all([
            checkExistence('container', {
                name: req.body.tagParams.container,
                status: { $ne: Status.Deleted }
            }, 'body.tagParams.container'),
            checkExistence('card', {
                id: req.body.tagParams.card,
                campaignId: req.body.tagParams.campaign,
                status: { $ne: Status.Deleted }
            }, 'body.tagParams.card'),
            checkExistence('campaign', {
                id: req.body.tagParams.campaign,
                status: { $nin: campFinished }
            }, 'body.tagParams.campaign'),
            checkExistence('experience', {
                id: req.body.tagParams.experience,
                'status.0.status': { $ne: Status.Deleted }
            }, 'body.tagParams.experience'),
        ])
        .then(function() {
            if (!doneCalled) {
                return checkExistence('advertiser', {
                    id: ld.get(req, 'campaign.advertiserId', null),
                    status: { $ne: Status.Deleted }
                }, 'campaign.advertiserId');
            }
            return q();
        })
        .then(function() {
            if (!doneCalled) {
                return next();
            }
        });
    };

    /* jshint camelcase: false */
    
    // Format pixel url to add to beeswax creative content
    placeModule.formatPixelUrl = function(tagParams, c6Id) {
        var pixelUrl = placeModule.config.beeswax.trackingPixel + '?';

        pixelUrl += querystring.stringify(ld.pickBy({
            placement       : c6Id,
            campaign        : tagParams.campaign,
            container       : tagParams.container,
            event           : 'impression'
        }));

        [
            { field: 'hostApp', qp: 'hostApp' },
            { field: 'network', qp: 'network' },
            { field: 'uuid', qp: 'extSessionId' },
            { field: 'ex', qp: 'ex' },
            { field: 'vr', qp: 'vr' },
            { field: 'branding', qp: 'branding' },
            { field: 'domain', qp: 'domain' },
        ].forEach(function(obj) {
            var val;
            if (tagParams[obj.field]) {
                // Do not url-encode the field if it's a beeswax macro
                if (/{{.+}}/.test(tagParams[obj.field])) {
                    val = tagParams[obj.field];
                } else {
                    val = encodeURIComponent(tagParams[obj.field]);
                }
                pixelUrl += '&' + obj.qp + '=' + val;
            }
        });
        pixelUrl += '&cb={{CACHEBUSTER}}';
        
        return pixelUrl;
    };
   
    placeModule.appStoreToIABCats = function(asCats){
        return (asCats || []).map(function(cat){
            if (cat === 'Books')			 { return 'IAB1_1'; }    // (Books & Literature)
            if (cat === 'Business')			 { return 'IAB3_4'; }    // (Business Software)
            if (cat === 'Catalogs')			 { return 'IAB22'; }     // (Shopping)
            if (cat === 'Education')	     { return 'IAB5'; }      // (Education)
            if (cat === 'Entertainment')     { return 'IAB1'; }      // (Arts &Entertainment)
            if (cat === 'Finance')			 { return 'IAB13'; }     // (Personal Finance)
            if (cat === 'Food & Drink')	     { return 'IAB8'; }      // (Food & Drink)
            if (cat === 'Games')			 { return 'IAB9_30'; }   // (Video & Computer Games)
            if (cat === 'Health & Fitness')  { return 'IAB7'; }      // (Health & Fitness)
            if (cat === 'Lifestyle')	     { return 'IAB9'; }      // (Hobbies  & Interests)
            if (cat === 'Medical')			 { return 'IAB7'; }      // (Health & Medicine)
            if (cat === 'Music')			 { return 'IAB1_6'; }    // (Music)
            if (cat === 'Navigation')	     { return 'IAB19'; }     // (Tech & Computing)
            if (cat === 'News')			     { return 'IAB12'; }     // (News)
            if (cat === 'Photo & Video')     { return 'IAB9_23'; }   // (Photography)
            if (cat === 'Productivity')		 { return 'IAB3_4'; }    // (Business Software)
            if (cat === 'Reference')		 { return 'IAB5'; }      // (Education)
            if (cat === 'Social Networking') { return 'IAB24'; }     // (Uncategorized)
            if (cat === 'Sports')			 { return 'IAB17'; }     // (Sports)
            if (cat === 'Travel')			 { return 'IAB20'; }     // (Travel)
            if (cat === 'Utilities')		 { return 'IAB19'; }     // (Tech & Computing)
            if (cat === 'Weather')			 { return 'IAB15_10'; }  // (Science-Weather)
            return 'IAB24';     // (Uncategorized)
        });
    };

    // Format + return beeswax creative body. Returns null if tagType is unsupported
    placeModule.formatBeeswaxBody = function(req) {
        var log = logger.getLog(),
            origObj = req.origObj || {},
            c6Id = req.body.id || origObj.id,
            tagType = req.body.tagType || origObj.tagType;
            
        if (tagType !== 'mraid') {
            log.info('[%1] Can\'t create beeswax creative for tagType %2', req.uuid, tagType);
            return null;
        }

        if (!req.campaign) {
            log.error('[%1] Can\'t create beeswax creative without campaign for placement %2',
                req.uuid, c6Id);
            return null;
        }

        // Ensure that beeswax creative has {{CLICK_URL}} macro
        req.body.tagParams.clickUrls = req.body.tagParams.clickUrls || [];
        if (req.body.tagParams.clickUrls.indexOf('{{CLICK_URL}}') === -1) {
            req.body.tagParams.clickUrls.push('{{CLICK_URL}}');
        }
        req.body.showInTag.clickUrls = true;
        
        var beesBody = {
            advertiser_id: req.advertiser.beeswaxIds.advertiser,
            alternative_id: c6Id,
            creative_name: req.body.label || origObj.label || 'Untitled (' + c6Id + ')',
            creative_type: 0,
            creative_template_id: 13,
            sizeless: true,
            secure: true,
            active: true,
            width: 320,
            height: 480,
            creative_content: {
                ADDITIONAL_PIXELS: [{
                    PIXEL_URL: placeModule.formatPixelUrl(req.body.tagParams, c6Id)
                }]
            },
            creative_attributes: {
                mobile: {
                    mraid_playable: [true]
                },
                technical : {
                    banner_mime : ['text/javascript','application/javascript']
                }
            }
        }, adUri;

        if ( req.campaign.product) {
            if (req.campaign.product.uri) {
                adUri = url.parse(req.campaign.product.uri);
                beesBody.creative_attributes.advertiser = {
                    advertiser_domain : [adUri.protocol + '//' + adUri.hostname ],
                    landing_page_url: [adUri.protocol + '//' + adUri.host + adUri.pathname],
                };
            } else {
                log.warn('[%1] Placement %2, campaign %3 has no product uri, beeswax creative' +
                    ' will likely not be approved.', req.uuid, c6Id, req.campaign.id);
            }

            if (req.campaign.product.categories) {
                if (!beesBody.creative_attributes.advertiser){
                    beesBody.creative_attributes.advertiser = {};
                }
                beesBody.creative_attributes.advertiser.advertiser_category =
                    placeModule.appStoreToIABCats(req.campaign.product.categories);
            } else {
                log.warn('[%1] Placement %2, campaign %3 has no categories, beeswax creative' +
                    ' will likely not be approved on Mopub.', req.uuid, c6Id, req.campaign.id);
            }
        } else {
            log.warn('[%1] Placement %2, campaign %3 has no product, beeswax creative' +
                ' will likely not be approved.', req.uuid, c6Id, req.campaign.id);
        }

        var templatePath = path.join(__dirname, '../templates/beeswaxCreatives/mraid.html'),
            tagHtml = fs.readFileSync(templatePath, 'utf8'),
            opts = { placement: c6Id };
        
        Object.keys(req.body.showInTag || {}).forEach(function(key) {
            if (req.body.showInTag[key] === true && !!req.body.tagParams[key]) {
                opts[key] = req.body.tagParams[key];
            }
        });
        beesBody.creative_content.TAG = tagHtml.replace('%OPTIONS%', JSON.stringify(opts));
        
        return beesBody;
    };

    placeModule.attachBeeswaxThumbnail = function(beeswax, req, beesBody){
        var log = logger.getLog(),
            origObj = req.origObj,
            c6Id = (origObj || req.body).id,
            thumbnailUrl;

        if (!req.campaign) {
            log.warn('[%1] Can\'t attach beeswax thumbnail without campaign for placement %2',
                req.uuid, c6Id);
            return q(beesBody);
        }

        if (!req.campaign.product){
            log.warn('[%1] Can\'t find product in campaign %2 on placement %3',
                req.uuid, req.campaign.id, c6Id);
            return q(beesBody);
        }

        (req.campaign.product.images || []).forEach(function(img){
            if (img.type === 'thumbnail') {
                thumbnailUrl = img.uri;
            }
        });

        if (!thumbnailUrl){
            log.warn('[%1] Can\'t find thumbnail in campaign %2 on placement %3',
                req.uuid, req.campaign.id, c6Id);
            return q(beesBody);
        }

        if (thumbnailUrl === (origObj || req.body).thumbnailSourceUrl){
            return q(beesBody);
        }

        return beeswax.uploadCreativeAsset({
            sourceUrl    : thumbnailUrl,
            advertiser_id: req.advertiser.beeswaxIds.advertiser
        })
        .then(function(asset){
            log.info('[%1] Created asset %2 for placement %3',
                req.uuid, asset.path_to_asset, c6Id);
            beesBody.creative_thumbnail_url = asset.path_to_asset;
            req.body.thumbnailSourceUrl = thumbnailUrl;
            return beesBody;
        })
        .catch(function(e){
            log.warn('[%1] uploadCreativeAsset failed on placement %2 with: %3',
               req.uuid, c6Id, (e.message  ? e.message : util.inspect(e)));
            return beesBody;
        });

    };
    
    // Create a new Creative in Beeswax, if tagParams.container === 'beeswax'
    placeModule.createBeeswaxCreative = function(beeswax, req, next, done) {
        var log = logger.getLog(),
            c6Id = req.body.id;
        
        if (req.body.tagParams.container !== 'beeswax') {
            log.trace('[%1] Not setting up beeswax creative for %2 placement',
                      req.uuid, req.body.tagParams.container);
            return q(next());
        }
        if (!ld.get(req.advertiser, 'beeswaxIds.advertiser', null)) {
            log.info('[%1] Advert %2 has no beeswax id, not creating creative',
                     req.uuid, req.advertiser.id);
            return q(next());
        }
        
        var beesBody = placeModule.formatBeeswaxBody(req);
        if (!beesBody) {
            return q(next());
        }
    
        return placeModule.attachBeeswaxThumbnail(beeswax, req, beesBody)
        .then(beeswax.creatives.create)
        .then(function(resp) {
            if (!resp.success) {
                log.warn('[%1] Creating beeswax creative failed: %2', req.uuid, resp.message);
                return done({
                    code: resp.code || 400,
                    body: 'Could not create beeswax creative'
                });
            }

            var beesId = resp.payload.creative_id;
            log.info('[%1] Created beeswax creative %2 for %3', req.uuid, beesId, c6Id);
            
            req.body.beeswaxIds = { creative: beesId };
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error creating beeswax creative for %2: %3',
                      req.uuid, c6Id, error.message || util.inspect(error));
            return q.reject('Error creating beeswax creative');
        });
    };
    
    // Edit the creative in Beeswax, if one exists for this placement
    placeModule.editBeeswaxCreative = function(beeswax, req, next, done) {
        var log = logger.getLog(),
            c6Id = req.origObj.id,
            beesId = ld.get(req.origObj, 'beeswaxIds.creative', null);
        
        if (!beesId) {
            log.trace('[%1] C6 placement %2 has no beeswax creative', req.uuid, c6Id);
            return q(next());
        }
        if (!req.body.tagParams) { // skip if not editing tagParams
            return q(next());
        }
        
        var beesBody = placeModule.formatBeeswaxBody(req);
        if (!beesBody) {
            return q(next());
        }
        
        return placeModule.attachBeeswaxThumbnail(beeswax, req, beesBody)
        .then(function(bb){
            return beeswax.creatives.edit(beesId, bb);
        })
        .then(function(resp) {
            if (!resp.success) {
                log.warn('[%1] Editing beeswax creative %2 failed: %3',
                         req.uuid, beesId, resp.message);
                return done({
                    code: resp.code || 400,
                    body: 'Could not edit beeswax creative'
                });
            }
            log.info('[%1] Edited beeswax creative %2 for %3', req.uuid, beesId, c6Id);
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error editing beeswax creative %2 for %3: %4',
                      req.uuid, beesId, c6Id, error.message || util.inspect(error));
            return q.reject('Error editing beeswax creative');
        });
    };
    
    /* jshint camelcase: true */
    
    placeModule.getPublicPlacement = function(svc, cache, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user', 'externalCost', 'costHistory', 'budget'];

        log.info('[%1] Guest user trying to get placement %2', req.uuid, id);

        return cache.getPromise({ id: id })
        .spread(function(placement) {
            // only show active placements
            if (!placement || placement.status !== Status.Active) {
                return q();
            }
            
            log.info('[%1] Retrieved placement %2', req.uuid, id);
            
            privateFields.forEach(function(key) { delete placement[key]; });
            placement = svc.formatOutput(placement);
            
            return placement;
        })
        .catch(function(error) {
            log.error('[%1] Error getting placement %2: %3', req.uuid, id, util.inspect(error));
            return q.reject('Mongo error');
        });
    };
    
    placeModule.handlePublicGet = function(req, res, svc) {
        var cacheControl = placeModule.config.cacheTTLs.cloudFront * 60;

        return svc.getPublicPlacement(req.params.id, req)
        .then(function(placement) {
            // don't cache requests in preview mode
            if (!req.query.preview) {
                res.header('cache-control', 'max-age=' + cacheControl);
            }
            
            if (!placement) {
                return q({ code: 404, body: 'Placement not found' });
            }
            
            // if ext === 'js', return placement as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(placement) + ';'});
            } else {
                return q({ code: 200, body: placement });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving placement', detail: error }});
        });
    };
    
    
    placeModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        app.get('/api/public/placements?/:id([^.]+).?:ext?', function(req, res) {
            placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });

        var router      = express.Router(),
            mountPath   = '/api/placements?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('placements', { allowApps: true });
        
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving placement', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            ['user', 'org', 'tagParams.container', 'tagParams.experience',
             'tagParams.card', 'tagParams.campaign'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving placements', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating placement', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating placement', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req,res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting placement', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = placeModule;
}());
