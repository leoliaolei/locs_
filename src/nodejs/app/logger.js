/*!
 * Basic logger implemented with bunyan.
 * Created by liaol on 2016/03/27.
 */

'use strict';

var bunyan = require('bunyan');


/**
 * Create main logger
 * @param logName {String} Name of logger
 * @param logDir {String} Directory to save log files
 * @returns {{info:function,error:function,warn:function,debug:function,childLogger:function}} a bunyan logger
 */
function createLogger(logName, logDir) {
    var logFilename = logName;
    var logOptions = {
        name: logName,
        level: bunyan.DEBUG,
        serializers: bunyan.stdSerializers,
        streams: [
            {
                stream: process.stdout,
                level: "debug"
            },
            {
                level: 'debug',
                path: logDir + '/' + logFilename + '-debug.log',
                type: 'rotating-file',
                period: '1m',
                count: 3
            },
            {
                level: 'info',
                path: logDir + '/' + logFilename + '-info.log',
                type: 'rotating-file',
                period: '1m',
                count: 24
            },
            {
                level: 'error',
                path: logDir + '/' + logFilename + '-error.log',
                type: 'rotating-file',
                period: '1m',
                count: 24
            }
        ]
    };

    var logger = bunyan.createLogger(logOptions);
    /**
     * @param name
     * @returns {XMLList}
     */
    logger.childLogger = function (name) {
        return logger.child({_log: name});
    };
    return logger;
}


module.exports = {
    createLogger: createLogger
};
