/**
 * User account management, authentication.
 * TODO: extract auth from user?
 */

'use strict';

const Q = require('q');
const passport = require("passport");
const mongoose = require("mongoose");
// const QqStrategy = require("passport-qq").Strategy;
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const errors = require('restify').errors;
var authService = new AuthService();
var logger = console;
var oauthProviders = {};
/**
 * Save global chrome extension ids
 * @type {Array}
 */
var chromeIds = [];
/**
 * Valid for 30 days
 * @type {number} Session timeout in millis
 */
var SESSION_TIMEOUT = 30 * 24 * 60 * 60 * 1000;


/**
 * Guess session id from HTTP request
 * @param request {*} HTTP request
 * @returns {String|null} session id
 */
var guessSessionId = function (request) {
    //console.log(req.headers,req.headers['x-session-token']);
    var sid = request.headers['authorization'] || (request.body && request.body.sid) || (request.params && request.params.sid);
    //http://stackoverflow.com/questions/11985228/mongodb-node-check-if-objectid-is-valid
    return new RegExp("^[0-9a-fA-F]{24}$").test(sid + "") ? sid : null;
};

/**
 * User session
 * @constructor
 */
var Session = mongoose.model("Session", mongoose.Schema({
    timeout: Number,
    uid: String
}));

/**
 * oauth: {provider_as_String:{openId:String}}
 * @constructor
 */
var Account = mongoose.model("Account", mongoose.Schema({
    oauth: {},
    nickname: String,
    avatar: String,
    roles: [String],
    createdAt: Date,
    lastSignin: Date
}));

/**
 * User sign-in info sent back to client.
 * @constructor
 */
var SignInInfo = function () {
    /**
     * ObjectId formatted session ID
     * @type {String}
     */
    this.sid = undefined;
    /**
     * Roles
     * @type {[String]}
     */
    this.roles = [];
    /**
     * Nick name to be displayed
     * @type {string}
     */
    this.nickname = "";
    /**
     * Avatar URL
     * @type {string}
     */
    this.avatar = "";
    /**
     * Oauth provider
     * @type {string}
     */
    this.hasLogin = "";
};

/**
 * User account information
 * @constructor
 * @private
 */
var _Account = function () {
    // this.__status = undefined;
    // this.__lmt = undefined;
    /**
     * OAuth information
     * @type {{}} {provider_as_String:{openId:String}}
     */
    this.oauth = {};
    this.roles = [];
    /**
     *
     * @type {String}
     */
    this.nickname = undefined;
    /**
     *
     * @type {String}
     */
    this.avatar = undefined;

    // this.createdAt = Date.now();
};


/**
 *
 * @constructor
 */
function AuthService() {
}

/**
 * Create or update user session.
 * @param accountId {String} User account ID
 * @returns {Q<String>} Session ID
 */
function updateSession(accountId) {
    var d = Q.defer();
    var session = new Session();
    session.uid = accountId;
    session.timeout = Date.now() + SESSION_TIMEOUT;
    session.save(function (err, doc) {
        if (err)
            d.reject(err);
        else
            d.resolve(doc._id);
    });
    return d.promise;
}

/**
 * Let an OAuth authenticated user sign in application.
 * It will find or create account in database.
 * @param provider {String} oauth provider
 * @param openId {String} oauth openId
 * @param account {{oauth:{},nickname:string,avatar:string}} account information
 * @returns {Q<SignInInfo>} sign in information
 */
AuthService.prototype.loginUser = function (provider, openId, account) {
    var condition = {};
    condition["oauth." + provider + ".openId"] = openId;
    //logger.debug({condition: condition, account: account}, "loginUser");
    var d = Q.defer();
    Account.findOne(condition).exec(function (err, rec) {
        if (err) {
            d.reject(err);
        } else {
            if (!rec) {
                rec = new Account(account);
                rec.createdAt = Date.now();
            }
            // Update last sign in timestamp and admin role
            rec.lastSignin = Date.now();
            if (oauthProviders && oauthProviders[provider]) {
                var admins = oauthProviders[provider].admins || [];
                if (admins.indexOf(openId) >= 0) {
                    if (rec.roles.indexOf("admin") < 0)
                        rec.roles.push("admin");
                }
            }
            if (!rec) {
                //logger.info({account: rec}, "Create account");
            }
            rec.save(function (err, updated) {
                if (err)
                    d.reject(err);
                else {
                    updateSession(updated._id).then(function (sid) {
                        var sii = new SignInInfo();
                        sii.sid = sid;
                        sii.roles = rec.roles;
                        sii.nickname = account.nickname;
                        sii.avatar = account.avatar;
                        sii.hasLogin = provider;
                        d.resolve(sii);
                    }).catch(function (err) {
                        d.reject(err);
                    })
                }
            });
        }
    });
    return d.promise;
};

/**
 * Determine if a session has admin privilege.
 * @param sid {String} Session ID
 * @param assertive {boolean=} true to throw exception if has no admin role
 * @return {Q<boolean>} the value is always true if assertive==true
 */
AuthService.prototype.hasAdminRole = function (sid, assertive) {
    var d = Q.defer();
    this.findAccountBySession(sid, assertive).then(function (account) {
        var hasRole = account && account.roles && account.roles.indexOf("admin") >= 0;
        if (hasRole) {
            d.resolve(true);
        } else {
            if (assertive)
                throw new errors.UnauthorizedError("This session has no admin role");
            d.resolve(false);
        }
    }).catch(function (err) {
        d.reject(err);
    });
    return d.promise;
};

/**
 * Check if a valid session
 * @param sid {String} session ID from client side
 * @param renew {boolean} true to get a new session
 */
AuthService.prototype.checkSession = function (sid, renew) {
    var d = Q.defer();
    var session = new AuthService.Session(sid, 0);
    d.resolve(session);
    return d.promise;
};

/**
 * Find session bundled account id
 * @param sid {String} session id
 * @param assertive {boolean=} true to throw error if account not found
 * @returns {Q<String|Error>} account id, null if not found. Error if db error.
 * @throws {HttpError} if argument <tt>assertive</tt> is true and no account is found
 */
AuthService.prototype.findAccountIdBySession = function (sid, assertive) {
    //logger.debug({sid: sid}, "findAccountIdBySession");
    var d = Q.defer();
    if (!sid) {
        if (assertive)
            throw new errors.BadRequestError("No session id specified");
        else
            d.resolve(null);
    } else {
        Session.findOne({_id: sid}, function (err, session) {
            if (err) {
                d.reject(err);
            } else {
                if (session) {
                    d.resolve(session.uid);
                } else {
                    if (assertive)
                        throw new errors.NotFoundError("No account with session " + sid);
                    else
                        d.resolve(null);
                }
            }
        });
    }
    return d.promise;
};

/**
 * Find session bundled account
 * @param sid {String} session id
 * @param assertive {boolean=} true to throw error if account not found
 * @returns {Q<Account|Error>} account, null if not found. Error if db error.
 * @throws {HttpError} if argument <tt>assertive</tt> is true and no account is found
 */
AuthService.prototype.findAccountBySession = function (sid, assertive) {
    var d = Q.defer();
    this.findAccountIdBySession(sid, assertive).then(function (uid) {
        if (uid) {
            Account.findOne({_id: uid}).exec(function (err, account) {
                if (err) {
                    d.reject(err);
                } else {
                    if (account == null && assertive)
                        throw new HttpError(404, "No account with session " + sid);
                    d.resolve(account);
                }
            });
        } else {
            if (assertive)
                throw new HttpError(404, "No account with session " + sid);
            else
                d.resolve(null);
        }
    }).catch(function (err) {
        d.reject(err);
    });
    return d.promise;
};

/**
 *
 * @param config {{provider_name:{clientID:string,clientSecret:string,callbackURL:string}}} oauth providers
 */
function initRoutes(server, config) {
    oauthProviders = config || {};
    _configInterceptor(server);
    _routeAccount(server);
    _routeAuth(server);
    var isDebugAuth = true;

    function _routeAccount(server) {
        server.get("/api/1.0/my/profile", _getMyProfile);
        server.get("/api/my/profile", _getMyProfile);
        function _getMyProfile(req, res, next) {
            var sid = guessSessionId(req);
            authService.findAccountBySession(sid).then(function (account) {
                res.send({profile: account});
            }).catch(function (err) {
                res.send(err);
            });
        }


        server.get("/api/1.0/admin/accounts", _listAccounts);
        server.get("/api/admin/accounts", _listAccounts);
        function _listAccounts(req, res, next) {
            Account.find().select("-oauth.qq.accessToken -oauth.qq.refreshToken -oauth.google.accessToken -__v").exec(function (err, docs) {
                res.send(err ? err : docs);
                next();
            });
        }

        server.del("/api/1.0/admin/accounts/:uid", _deleteAccount);
        server.del("/api/admin/accounts/:uid", _deleteAccount);
        function _deleteAccount(req, res, next) {
            var uid = req.params.uid;
            //logger.debug({uid: uid}, "_deleteAccount");
            Account.remove({_id: uid}).exec(function (err, numberRemoved) {
                res.send(err ? err : {numberRemoved: numberRemoved});
                next();
            });
        }
    }

    function _routeAuth(server) {
        var config = oauthProviders["google"];
        if (config) {
            passport.use(new GoogleStrategy(config,
                function (accessToken, refreshToken, profile, done) {
                    return _processPassport(accessToken, refreshToken, profile, done);
                }
            ));
        }
        // passport.use(new QqStrategy(oauthProviders["qq"],
        //     function (accessToken, refreshToken, profile, done) {
        //         return _processPassport(accessToken, refreshToken, profile, done);
        //     }
        // ));

        server.get('/auth/:provider', _authWithProvider);
        /**
         * Submit auth to provider
         * @private
         */
        function _authWithProvider(req, res, next) {
            var provider = req.params.provider;
            var xcid = req.params["x-chromeId"];
            isDebugAuth = !!req.params["x-debug"];
            // Save chrome id, we need the id to send message back
            if (chromeIds && chromeIds.indexOf(xcid) < 0) {
                chromeIds.push(xcid);
            }
            if (provider == "google") {
                //https://accounts.google.com/o/oauth2/auth?response_type=code&redirect_uri=http%3A%2F%2Fapp.leoplay.com%3A7001%2Fauth%2Fgoogle%2Fcallback&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fplus.login&client_id=1020689494201-09gcvfq63pqs61uq6sjdugce6ot05ftb.apps.googleusercontent.com
                passport.authenticate('google', {
                        scope: ['https://www.googleapis.com/auth/plus.login']
                    }
                )(req, res, next);
            } else if (provider == "qq") {
                //https://graph.qq.com/oauth2.0/authorize?response_type=code&redirect_uri=http%3A%2F%2Fapp.leoplay.com%2Fstk%2Fqq-auth-callback.php&client_id=101208573
                passport.authenticate('qq')(req, res, next);
            } else {
                next(new Error("Not implemented oauth provider '" + provider + "'"));
            }
        }

        server.get('/auth/:provider/callback', _oauthCallback);
        /**
         * GET /auth/:provider/callback
         * Callback invoked by oauth provider.
         * This URL will be redirected as query parameter by auth provider.
         * @param req query contains parameter of code generated by QQ, like `code=895D42795764E0E0F2B47D18B901B14A`
         * @param res Content type of "text/html; charset=utf-8", content is javascript passing <tt>window.$$$$authResult</tt>.
         * It is a javascript object generated by <tt>Account.toClient()</tt>.
         */
        function _oauthCallback(req, res, next) {
            var provider = req.params.provider;
            passport.authenticate(provider,
                /**
                 * If authentication failed, user will be set to false.
                 * If an exception occurred, err will be set.
                 * An optional info argument will be passed, containing additional details provided by the strategy's verify callback.
                 * http://passportjs.org/docs/oauth2-api
                 */
                function (err, user, info) {
                    // This code is called after Strategy verification function
                    if (err) {
                        logger.error(err);
                        return next(err);
                    } else {
                        var strUser = JSON.stringify(user);
                        var strCrxIds = JSON.stringify(chromeIds);
                        var closeWindow = !isDebugAuth;
                        // Do NOT change the name of $$$$authResult, it will be called in client InAppViewer's "loadstop" event
                        var body = '<script>' +
                            'var $$$$authResult=' + strUser + ';' +
                            (isDebugAuth ? 'console.log($$$$authResult);' : '') +
                            'var _caller=window.opener||window.top;' +
                            '_caller.postMessage($$$$authResult,"*");' +
                            'if (window.chrome && window.chrome.runtime) {' +
                            /* 'var extIds=["ikphkfkemdlgpgkhkpejlkecfddaohki","imobnhhigdfbbbmihfmdaajiehfifhba"];' +*/
                            'var extIds=' + strCrxIds + ';' +
                            'extIds.forEach(function(extId){' +
                            'console.log("Send message to chrome "+extId);' +
                            'chrome.runtime.sendMessage(extId, {code: "MSG_OAUTH_RESULT",authResult:$$$$authResult}, function () {' + (closeWindow ? 'window.close();' : '') + '});' +
                            '});}' +
                            'console.log("DONE");' +
                            '</script>';
                        res.writeHead(200, {
                            'Content-Length': Buffer.byteLength(body),
                            'Content-Type': 'text/html; charset=utf-8'
                        });
                        res.write(body);
                        res.end();
                        next();
                        //logger.debug({response: body}, "oauthCallback");
                    }
                })(req, res, next);
        }


        /**
         * Process provider returned user information after successful authentication
         * @param accessToken
         * @param refreshToken
         * @param profile
         * @param done
         * @private
         */
        function _processPassport(accessToken, refreshToken, profile, done) {
            var provider = profile.provider;
            var prof = {
                openId: profile.id,
                nickname: "",
                provider: profile.provider,
                avatar: profile._json.figureurl_qq_2
            };
            if (provider == "google") {
                prof.nickname = profile.displayName;
                var imageUrl = profile._json.image.url;
                imageUrl = imageUrl.replace("sz=50", "sz=100");
                prof.avatar = imageUrl;
            } else if (provider == "qq") {
                prof.nickname = profile.nickname;
                prof.avatar = profile._json.figureurl_qq_2;
            } else {
                throw new Error("OAuth provider " + provider + " is not implemented");
            }

            var account = {oauth: {}, nickname: prof.nickname, avatar: prof.avatar};
            account.oauth[provider] = {openId: profile.id, accessToken: accessToken, refreshToken: refreshToken};

            // Since stk 0.8.2, return result is {sii} and {account} is deprecated
            authService.loginUser(provider, profile.id, account)
                .then(function (sii) {
                    return done(null, {
                        sii: sii,
                        account: {
                            nickname: sii.nickname,
                            avatar: sii.avatar,
                            hasLogin: sii.hasLogin,
                            sid: sii.sid,
                            roles: sii.roles
                        }
                    });
                }).catch(function (err) {
                return done(err);
            });
        }
    }

    /**
     * Intercept request for admin permission.
     * http://stackoverflow.com/questions/18411946/what-is-the-best-way-to-implement-a-token-based-authentication-for-restify-js
     * @param server
     */
    function _configInterceptor(server) {
        //logger.debug(server,"setupInterceptor");
        server.use(function _interceptAdmin(req, res, next) {
            var url = req.url;
            if (url.indexOf("/api/1.0/admin") >= 0 || url.indexOf("/api/admin") >= 0) {
                authService.hasAdminRole(guessSessionId(req), true).then(function (isAdmin) {
                    next();
                }).catch(function (err) {
                    return res.send(err);
                });
            } else {
                next();
            }
        });
    }
}

function initLogger(log) {
    logger = log;
}

module.exports = {
    initRoutes: initRoutes,
    initLogger: initLogger,
    authService: authService
};
