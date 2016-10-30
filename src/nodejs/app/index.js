/*!
 * Fundamental APIs to make a nodejs application run.
 *
 * Created by liaol on 2016/03/26.
 */

module.exports = {
    httpUtils: require('./util-http'),
    startServer: require('./server').startServer,
    createLogger: require('./logger').createLogger
};