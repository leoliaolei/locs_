'use strict';

function httpUtils() {
}

/**
 * @deprecated
 * @private
 */
httpUtils._logger = console;

/**
 * Send error to client
 * @param res {*} HTTP response
 * @param error {Error}
 * @param next
 */
httpUtils.sendError = function (res, error, next) {
    if (res.headersSent)
        return;
    res.send(error);
    return next && next();
};

/**
 * Get hostname from URL
 * @param url {String}
 * @returns {String}
 */
httpUtils.getHostname = function (url) {
    var result = /\/\/([^\/\?:]+)/i.exec(url);
    return result ? result[1] : url;
};

module.exports = httpUtils;