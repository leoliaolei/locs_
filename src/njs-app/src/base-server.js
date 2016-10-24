'use strict';

var restify = require('restify');
var _audit = require('./base-server-audit');

/**
 * Start server
 * @param appName {String} application name
 * @param port {Number}
 * @param logger {*} bunyan logger
 * @returns {*} server
 */
function startServer(appName, port, logger) {
    var server;
    if (!appName) {
        throw new TypeError("Require parameter appName in startServer(appName,port,logger)");
    }
    if (!logger) {
        throw new TypeError("Require parameter logger in startServer(appName,port,logger)");
    }
    if (!port) {
        throw new TypeError("Require parameter port in startServer(appName,port,logger)");
    }
    restify.CORS.ALLOW_HEADERS.push('x-requested-with');
    restify.CORS.ALLOW_HEADERS.push('authorization');
    server = restify.createServer({name: appName, log: logger});
    server.listen(port, function () {
        logger.info('Server started %s', server.url);
    });

    server.use(restify.CORS());
    server.use(restify.fullResponse());
    server.use(restify.queryParser());
    server.use(restify.bodyParser({mapParams: true}));
    server.use(restify.requestLogger());
    server.on('after', _audit({
        body: false,
        log: logger
    }));

    _initRoutes(server);
    _initExHandler(server);

    return server;

    /**
     * List all registered routes
     * http://stackoverflow.com/questions/24962005/how-to-get-list-of-all-routes-i-am-using-in-restify-server
     * @param server
     * @returns {{GET: Array, PUT: Array, DELETE: Array, POST: Array}}
     */
    function _getAllRoutes(server) {
        var result = {"GET": [], "PUT": [], "DELETE": [], "POST": []};
        Object.keys(result).forEach(function (key) {
            server.router.routes[key].forEach(function (value) {
                result[key].push(value.spec.path);
            });
        });
        return result;
    }

    function _initRoutes(server) {
        server.get("/_status", function _serverStatus(req, res, next) {
            res.send({status: "OK"});
        });
        server.get("/api/admin/_routes", function _serverRoutes(req, res, next) {
            res.send(_getAllRoutes(server));
        });
    }

    function _initExHandler(server) {
        /**
         * http://mcavage.me/node-restify/#error-handling
         */
        server.on("uncaughtException", function serverUncaughtExp(req, res, route, err) {
            logger.error(err, "uncaughtException");
            res.send(err);
        });
        process.on("uncaughtException", function processUncaughtExp(err) {
            var msg = "Uncaught fatal exception, process will exit now.";
            logger.fatal(err, msg);
            process.exit(1);
        });
    }
}

module.exports = {
    startServer: startServer
};
