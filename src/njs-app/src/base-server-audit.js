/*!
 * Modified from restify/lib/plugins/audit.js
 * Created by liaol on 2016/02/29.
 */

var restify = require('restify');
var bunyan = require('bunyan');

var HttpError = restify.errors.HttpError;

///--- API

/**
 * Returns a Bunyan audit logger suitable to be used in a server.on('after')
 * event.  I.e.:
 *
 * server.on('after', restify.auditLogger({ log: myAuditStream }));
 *
 * This logs at the INFO level.
 *
 * @param {Object} options at least a bunyan logger (log).
 * @return {Function} to be used in server.after.
 */
function auditLogger(options) {
    //assert.object(options, 'options');
    //assert.object(options.log, 'options.log');
    var errSerializer = bunyan.stdSerializers.err;

    if (options.log.serializers && options.log.serializers.err) {
        errSerializer = options.log.serializers.err;
    }

    var log = options.log.child({
        audit: true,
        serializers: {
            err: errSerializer,
            req: function auditRequestSerializer(req) {
                if (!req)
                    return (false);

                var timers = {};
                (req.timers || []).forEach(function (time) {
                    var t = time.time;
                    //LEO: t is high-resolution real time in format of [seconds, nanoseconds], we convert it to ms
                    //var _t = Math.floor((1000000 * t[0]) + (t[1] / 1000));
                    var _t = Math.floor((1000 * t[0]) + (t[1] / 1000000));
                    timers[time.name] = _t;
                });
                return ({
                    method: req.method,
                    url: req.url,
                    //headers: req.headers,
                    //httpVersion: req.httpVersion,
                    //trailers: req.trailers,
                    //version: req.version(),
                    //body: options.body === true ?
                    //    req.body : undefined,
                    timers: timers
                });
            },
            res: function auditResponseSerializer(res) {
                if (!res)
                    return (false);


                var body;
                if (options.body === true) {
                    if (res._body instanceof HttpError) {
                        body = res._body.body;
                    } else {
                        //body = res._body;
                        body = res._body;
                    }
                }

                return ({
                    statusCode: res.statusCode,
                    //headers: res._headers,
                    //trailer: res._trailer || false,
                    body: body
                });
            }
        }
    });

    function audit(req, res, route, err) {
        var latency = res.get('Response-Time');
        if (typeof (latency) !== 'number')
            latency = Date.now() - req._time;
        var obj = {
            //remoteAddress: req.connection.remoteAddress,
            //remotePort: req.connection.remotePort,
            //req_id: req.getId(),
            req: req,
            res: res,
            err: err,
            latency: latency
            //secure: req.secure,
            //_audit: true
        };

        log.info(obj, 'handled: %d', res.statusCode);

        return (true);
    }

    return (audit);
}


///-- Exports

module.exports = auditLogger;

