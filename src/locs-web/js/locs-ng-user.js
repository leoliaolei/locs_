/**
 * Account, authentication and authorization.
 * @author Leo Liao, 2016/06/12, created
 */

(function locs_web_user(module) {
    'use strict';

    var mod = angular.module(module, ['bmb.app']);


    /**
     * @ngdoc service
     * @name bmUserAccount
     * @description Stores user account information, for display purpose in most cases.
     * Be noted that account id is not saved because we save session id (sid) instead.
     * @return
     * - hasLogin: {boolean|string} if login, save oauth provider name like "google"
     * - avatar: {string} base64 encoded image
     * - roles: {[string]}
     * - nickname: {string}
     * - logout: {function}
     *
     */
    mod.service("bmUserAccount", ['bmSettingFactory',
        function bmUserAccount(bmSettingFactory) {
            var STORE_NAME = "account";
            var defaults = {
                hasLogin: false,
                avatar: null,
                roles: [],
                nickname: null
            };
            var ua = bmSettingFactory.getSetting(STORE_NAME, defaults);
            ua.logout = function () {
                Object.keys(defaults).forEach(function (key) {
                    delete ua[key];
                });
                ua.save();
            };
            return ua;
        }]);

    /**
     * @ngdoc service
     * @name locsEnvUtils
     * @description Environment utilities
     */
    mod.service('locsEnvUtils', [function locsEnvUtils() {
        var that = this;

        /**
         * Async call to get current URL
         * @param callback
         */
        this.getCurrentUrl = function (callback) {
            if (that.isChromeExtension()) {
                chrome.tabs.getSelected(null, function (tab) {
                    callback && callback(tab.url);
                });
            } else {
                callback && callback(window.location.href);
            }
        };

        this.getClipboard = function () {
            if (that.isAndroidApp()) {
                if (!cordova.plugins)
                    return alert("Program Error: Cannot find cordova.plugins");
                return cordova.plugins.clipboard
            } else {
                return {
                    copy: function (text, onSuccess, onFail) {
                        alert("Not implemented");
                    },
                    paste: function (onSuccess, onFail) {
                        onSuccess && onSuccess("Fake clipboard");
                    },
                    hasText: function (onSuccess, onFail) {
                        onSuccess && onSuccess(true);
                    }
                };
            }
        };

        /**
         * If this is used in Chrome extension
         * @returns {boolean}
         */
        this.isChromeExtension = function () {
            return window.location.href.indexOf("chrome-extension") == 0;
        };

        /**
         * Options and popup share the same HTML page
         * @returns {*|boolean}
         */
        this.isChromeExtensionOptions = function () {
            return this.isChromeExtension() && window.location.href.indexOf("options.html") >= 0;
        };

        /**
         * If this is an Android application powered by PhoneGap
         * @returns {boolean}
         */
        this.isAndroidApp = function () {
            return window.location.href.indexOf("file:///android_asset") == 0;
        };

        /**
         * Add listener for android share event.
         * @param callback {function(string)}
         */
        this.registerShareEvent = function (callback) {
            // deviceready is Cordova's init event
            document.addEventListener('deviceready', function () {
                if (cordova.plugins && cordova.plugins.webintent) {
                    cordova.plugins.webintent.getExtra(cordova.plugins.webintent.EXTRA_TEXT, function (data) {
                        console.debug("cordova.plugins.webintent.EXTRA_TEXT: " + JSON.stringify(data));
                        callback && callback(data);
                    }, function () {
                    });
                }
            });
        };
    }]);
    /**
     * Read image as base64 encoded data URL
     * @param src {string}
     * @param callback {function(String)} parameter of dataURL
     */
    var imageToDataUrl = function (src, callback) {
        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d');
        var image = document.createElement('img');
        image.setAttribute('crossOrigin', 'anonymous');
        var imageType = "png";
        image.onerror = image.onabort = function () {
            console.warn("Cannot load image " + src);
            callback && callback(src);
        };
        image.onload = function () {
            // You can get real image's sizes after loading it
            canvas.width = image.width;
            canvas.height = image.height;
            context.drawImage(image, 0, 0);
            //console.log("image.onload", canvas, context);
            try {
                var s = canvas.toDataURL('image/' + imageType);
                callback && callback(s);
            } catch (err) {
                //In IE11, SecurityError will not go to .onerror event.
                console.warn(err.message, "imageToDataUrl:canvas.toDataURL:" + src);
                callback && callback(src);
            }
        };
        image.src = src;
    };
    /**
     *  @ngdoc object
     *  @name locsOauthService
     *  @description
     *
     *  1. InAppViewer cannot listen to event of "message" generated by <tt>window.postMessage</tt>
     *     InAppBrowser supports limited 4 events: loadstart, loadstop, loaderror, exit
     *     http://plugins.cordova.io/#/package/org.apache.cordova.inappbrowser
     *     http://blogs.telerik.com/appbuilder/posts/13-12-23/cross-window-communication-with-cordova's-inappbrowser
     *  2. Google oauth page cannot be embedded in a frame because it set 'X-Frame-Options' to 'SAMEORIGIN'.
     *     Exception in iframe: Refused to display 'https://accounts.google.com/o/oauth2/auth?response_type=code&redirect_uri=h…=1020689494201-09gcvfq63pqs61uq6sjdugce6ot05ftb.apps.googleusercontent.com' in a frame because it set 'X-Frame-Options' to 'SAMEORIGIN'.
     *  3. Talk to InAppViewer with phonegap's executeScript
     *  4. Talk to iFrame with `window.postMessage`
     */
    mod.service('locsOauthService', ['$timeout', 'locsEnvUtils', 'bmUserAccount', 'bmApp',
        function locsOauthService($timeout, locsEnvUtils, bmUserAccount, bmApp) {
            var sidStorageKey = bmApp.appName + "-sid";
            var that = this;
            /**
             * Convert sign in info to account object
             * @param sii
             * @param callback {function} success callback
             */
            var toUserAccount = function (sii, callback) {
                that.saveSessionId(sii.sid);
                bmUserAccount.hasLogin = sii.hasLogin;
                bmUserAccount.nickname = sii.nickname;
                bmUserAccount.roles = sii.roles;
                var avatar = sii.avatar;
                imageToDataUrl(avatar, function (dataUrl) {
                    //console.log(dataUrl);
                    bmUserAccount.avatar = dataUrl;
                    bmUserAccount.save().then(function () {
                        callback && callback();
                    });
                });
            };

            var _loginWithIframe = function () {
                $scope.useIframe = true;
                $scope.authUrl = $sce.trustAsResourceUrl(authUrl);
                var iframe = document.getElementById('app-oauth-iframe');
                iframe.setAttribute("src", authUrl);
                $ionicLoading.show();
                iframe.onload = function () {
                    $ionicLoading.hide();
                };
                window.addEventListener("message", function (e) {
                    var account = e.data.account;
                    toUserAccount(account);
                }, false);
            };

            /**
             * Login in a pop-up window
             * @param authUrl {string} server side url for authentication
             * @param callback {function}
             * @private
             */
            var _loginWithPopup = function (authUrl, callback) {
                //Attention: PhoneGap InAppBrowser will overwrite window.open
                var newWin = window.open(authUrl, "_blank");
                //TODO: http://stackoverflow.com/questions/1827616/javascript-window-open-returns-null-in-32-bit-ie8-on-win7-x64
                //console.log(JSON.stringify(newWin));
                $timeout(function () {
                    if (!newWin) {
                        alert("The sign-in page opens in a pop-up window. Please check if pop-up window is disabled by your browser");
                    }
                }, 3000);

                // 1. loaderror and loadstop is used for Codorva

                // Need add <access origin="http://qq.com" subdomains="true"/> in Codorva config.xml
                // Otherwise, QQ auth page will halt in "授权信息加载中..." if the auth url is opened in window.open(url) (without target of "_blank" or "_system") or iframe
                // LEO@20151128:As of version 3.0, Cordova implements device-level APIs as plugins. Use the CLI's plugin command, described in The Command-line Interface, to add or remove this feature for a project:
                // https://groups.google.com/forum/#!topic/phonegap/e5_5unC2fYs
                newWin.addEventListener('loaderror', function (event) {
                    alert('Error: ' + event.message);
                });
                newWin.addEventListener("loadstop", function (event) {
                    newWin.executeScript({
                            // This may cause exception
                            // 04-28 16:51:56.319  32426-32502/com.leoplay.stk W/WebView﹕ java.lang.Throwable: A WebView method was called on thread 'JavaBridge'. All WebView methods must be called on the same thread. (Expected Looper Looper (main, tid 1) {43c0d1d0} called on Looper (JavaBridge, tid 27372) {43d007f8}, FYI main Looper is Looper (main, tid 1) {43c0d1d0})
                            code: "window.$$$$authResult"
                        },
                        function (values) {
                            //console.log(JSON.stringify(values));
                            if (values) {
                                var authResult = values[0];
                                if (authResult) {
                                    // authResult is an object like
                                    // {"account":{"sid":"553e02717b27f4bc339ce032","avatar":"http://q.qlogo.cn/qqapp/101208573/94CE7A4A2B34A294D353BED03597618F/100","nickname":"鸭蛋"}}
                                    toUserAccount(authResult.sii || authResult.account, callback);
                                    newWin.close();
                                }
                            }
                        });
                });

                // 2. Used for desktop browser
                window.addEventListener("message", function (e) {
                    var account = e.data.sii || e.data.account; // e.data.account is used for compatibility with version before 0.8.2
                    //console.debug(account, "OauthCtrl.eventListener:message");
                    toUserAccount(account, callback);
                    newWin.close();
                }, false);

                // 3. Used for chrome extension
                if (locsEnvUtils.isChromeExtension()) {
                    chrome.runtime.onMessageExternal.addListener(function (msg, sender, sendResponse) {
                        switch (msg.code) {
                            case "MSG_OAUTH_RESULT":
                                //console.debug(msg, "OauthCtrl.chromeRuntimeMessageExternal:MSG_OAUTH_RESULT");
                                //console.debug(newWin,"newWin");
                                //TODO: cannot close window in chrome extension
                                newWin.close();
                                toUserAccount(msg.authResult.sii || msg.authResult.account, callback);
                                sendResponse();
                                break;
                        }
                    });
                }
            };

            this.readSessionId = function () {
                var item = localStorage.getItem(sidStorageKey);
                if (item == "null")
                    item = null;
                return item;
            };
            this.saveSessionId = function (sid) {
                if (!sid) {
                    localStorage.removeItem(sidStorageKey);
                    return null;
                }
                return localStorage.setItem(sidStorageKey, sid);
            };
            this.doLogin = function (provider, authUrl, callback) {
                if (bmUserAccount.hasLogin) {
                    callback && callback();
                    return;
                }
                if (locsEnvUtils.isChromeExtension()) {
                    //TODO: does not work
                    authUrl += "?x-chromeId=" + chrome.runtime.id;
                } else {
                }
                console.debug(authUrl, "OauthCtrl");
                if (provider == "google") {
                    _loginWithPopup(authUrl, callback);
                } else {
                    alert("ERROR: Provider '" + provider + "' not implemented");
                }
            }
        }]);
    /**
     * Add session id in HTTP request
     * https://github.com/angular/angular.js/issues/9247
     */
    mod.config(['$httpProvider', function _configHttpProvider($httpProvider) {
        $httpProvider.interceptors.push(['$q', 'bmApp', 'locsOauthService', function sessionInjector($q, bmApp, locsOauthService) {
            var serverUrl = bmApp.serverBaseUrl;
            return {
                request: function (config) {
                    var url = config.url;
                    if (url.indexOf(serverUrl) == 0) {
                        var sid = locsOauthService.readSessionId();
                        if (!config.headers) config.headers = {};
                        config.headers["Authorization"] = sid;
                        return config || $q.when(config);
                    }
                    return config;
                }
            };
        }]);
    }]);
})('locs-ng-user');