'use strict';

function httpUtils() {
}

/**
 * @deprecated
 * @private
 */
httpUtils._logger = console;

/**
 * Guess session id from HTTP request
 * @param request {*} HTTP request
 * @returns {String|null} session id
 * @deprecated placed in `njs-user`
 */
httpUtils.guessSessionId = function (request) {
    //console.log(req.headers,req.headers['x-session-token']);
    var sid = request.headers['authorization'] || (request.body && request.body.sid) || (request.params && request.params.sid);
    //http://stackoverflow.com/questions/11985228/mongodb-node-check-if-objectid-is-valid
    return new RegExp("^[0-9a-fA-F]{24}$").test(sid + "") ? sid : null;
};

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

/**
 * Set logger for logging errors.
 * @param logger {*} bunyan logger
 * @return {httpUtils}
 * @deprecated
 */
httpUtils.errorLogger = function (logger) {
    httpUtils._logger = logger;
    return httpUtils;
};

module.exports = httpUtils;