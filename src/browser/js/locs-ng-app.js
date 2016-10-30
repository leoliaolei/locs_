/*!
 * Core application definitions and bootstrap functions.
 */
(function locs_ng_app(module) {
    'use strict';

    window.bmb = window.bmb || {};
    bmb.client = {
        /**
         * Definition of application.
         * @constructor
         */
        AppDef: function (appName) {
            if (!appName) {
                throw new TypeError("Need appName in bmb.clientAppDef(appName)");
            }
            /**
             * Application name
             * @type {String}
             */
            this.appName = appName;
            /**
             * Author's email
             * @type {String}
             */
            this.appEmail = "";
            /**
             * Application version
             * @type {String}
             */
            this.appVersion = "";
            /**
             * Data version
             * @type {Number}
             */
            this.dataVersion = 0;
            /**
             * Server URL
             * @type {String}
             */
            this.serverBaseUrl = "";

            /**
             * Translation languages
             * @type {{langKey:{name:String, translation:{}}}}
             */
            this.languages = {};
        }
    };

    var mod = angular.module(module, ['pascalprecht.translate']);

    /**
     * @ngdoc provider
     * @name bmApp
     * @description bmAppProvider defines basic application configuration.
     *
     */
    mod.provider('bmApp', function bmAppProvider() {
        var appDef = new bmb.client.AppDef("bmApp");
        this.setAppDef = function (def) {
            appDef = def;
        };
        this.getAppDef = function () {
            return appDef;
        };
        this.$get = [function () {
            return appDef;
        }];
    });
    

    //---------------------------------------------------------------------
    // Application specific injection
    //---------------------------------------------------------------------
    /**
     * @ngdoc object
     * @name bmAppUpdaterFn
     * @param {string} old version
     * @description a function need override by your application to upgrade application persistent data.
     */
    mod.factory('bmAppUpdaterFn',
        function bmAppUpdaterFn() {
            return angular.noop;
        });
    /**
     * @ngdoc object
     * @name bmAppDataRestoreFn
     * @description a function need override by your application to restore data.
     */
    mod.factory('bmAppDataRestoreFn',
        function bmAppDataRestoreFn() {
            return angular.noop;
        });
})("bmb.app");