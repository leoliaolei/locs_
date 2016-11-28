(function (module) {
    'use strict';
    angular.module(module, [])
        .filter('fromNow', function () {
            return function fromNow(input) {
                if (!input)
                    return "";
                return moment(input).fromNow();
            };
        })
        .filter('t', ['$parse', '$translate', function ($parse, $translate) {
            return function t(translationId, interpolateParams, interpolation) {
                if (!angular.isObject(interpolateParams)) {
                    interpolateParams = $parse(interpolateParams)();
                }
                var t = $translate.instant(translationId, interpolateParams, interpolation);
                console.debug($translate('common.COLOR'));
                console.debug(translationId, t);
                return  t;
            };
        }])
        .filter('bytes', function () {
            return function bytesFn(bytes, precision) {
                if (bytes == 0 || isNaN(parseFloat(bytes)) || !isFinite(bytes)) return '-';
                if (typeof precision === 'undefined') precision = 1;
                var units = ['bytes', 'kB', 'MB', 'GB', 'TB', 'PB'],
                    number = Math.floor(Math.log(bytes) / Math.log(1024));
                return (bytes / Math.pow(1024, Math.floor(number))).toFixed(precision) + ' ' + units[number];
            }
        });
}("bm.filters"));