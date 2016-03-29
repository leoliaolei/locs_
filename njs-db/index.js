/*!
 * Created by liaol on 2016/03/26.
 */

/*!
 * Basic database and model operations.
 */

var bmb = require('./src/bmb-sci');
var db = require('./src/bmb-db');

module.exports = {
    BaseModel: bmb.BaseModel,
    BaseEntityService: db.BaseEntityService
};