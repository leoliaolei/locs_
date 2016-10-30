/*!
 * Database operation with mongoose.
 */

var _ = require('lodash');
var async = require('async');
var mongoose = require('mongoose');
var Q = require("q");
var sci = require('./bmb-sci');

var logger = require('bunyan').createLogger({name: "mongo", level: 'debug'});

/**
 * Update entity's last modified time to current timestamp
 * @param entity {Object}
 * @private
 */
function _updateLmt(entity) {
    entity[sci.EntityFields.LAST_MODIFIED] = sci.utcTimestamp();
}

/**
 * Create a mongoose model.
 * @param name {String} model name
 * @param schema {Object} fields definition
 * @param includeSyncFields {boolean} true to include basic fields for synchronization like __cid, __lmt, __status
 * @returns {*}
 */
function mongoModel(name, schema, includeSyncFields) {
    var fields = schema;
    if (includeSyncFields) {
        fields[sci.EntityFields.CLIENT_ID] = String;
        fields[sci.EntityFields.LAST_MODIFIED] = Number;
        fields[sci.EntityFields.ACCOUNT_ID] = String;
        fields[sci.EntityFields.STATUS] = Number;
    }
    return mongoose.model(name, mongoose.Schema(fields));
}

var AuditModel = mongoose.model('Audit', mongoose.Schema({
    //_id: {
    //    type: String,
    //    unique: true,
    //    'default': shortid.generate
    //},
    action: {
        type: String,
        required: true
    },
    timestamp: Number,
    entity: String,
    entityId: String
}));
/**
 * Auditor to manage audit logs.
 * @constructor
 */
function Auditor() {
}

/**
 * Records the operation on an object in logs.
 * @param action {string} the name of action on target object.
 * @param entityType {string} the type or class of target object.
 * @param entityId {string} the identifier of target object.
 */
Auditor.prototype.log = function (action, entityType, entityId) {
    var audit = new AuditModel();
    audit.action = action;
    audit.entity = entityType;
    audit.entityId = entityId;
    audit.timestamp = sci.utcTimestamp();
    audit.save();
};

function handleError(err) {
    logger.error(err);
}

/**
 * Server side operation.
 * @param model {*} A mongoose model of entity
 * @param modelPrototype
 * @constructor
 */
function EntityDao(model, modelPrototype) {
    var EntityModel = model;
    var auditor = new Auditor();


    /**
     * Save changes from client side
     * @param userId {String} user account ID
     * @param changes {[]} changed events need sync
     * @param options {{forceCreationIfNotFound:boolean}=}
     * @return {Q<{created:[],deleted:[],updated:[],rejected:[]}>} a promise
     */
    function saveClientChanges(userId, changes, options) {
        var d = Q.defer();
        var finalResult = {deleted: [], created: [], updated: [], rejected: []};
        options = options || {forceCreationIfNotFound: false};

        /**
         * Determine if an id generated from client side. A client side id matches one of following conditions
         * 1. empty: 0, null, undefined, blank
         * 2. a ms timestamp (like new Date().getTime()) whose length is 13
         * @param id {number|string}
         * @returns {boolean}
         */
        var isClientId = function (id) {
            return (!id || id.length == 13);
        };

        /**
         * Put selected key properties from an entity for result response.
         * @param entity {*} Entity
         * @param code {*=} optional code to identify extra info like error reason
         * @returns {{}}
         */
        function toSyncResult(entity, code) {
            var obj = {};
            obj[sci.EntityFields.CLIENT_ID] = entity[sci.EntityFields.CLIENT_ID];
            obj[sci.EntityFields.ID] = entity[sci.EntityFields.ID];
            obj[sci.EntityFields.STATUS] = entity[sci.EntityFields.STATUS];
            obj[sci.EntityFields.LAST_MODIFIED] = entity[sci.EntityFields.LAST_MODIFIED];
            if (code)
                obj.code = code;
            return obj;
        }

        function _rejectChange(entity, code) {
            finalResult.rejected.push(toSyncResult(entity, code));
        }

        /**
         * Create new entities from client changes
         * @param change
         * @param callback {function(Error)}
         */
        function _createFromClient(change, callback) {
            var doc = {};
            _.assign(doc, change);
            doc[sci.EntityFields.CLIENT_ID] = doc[sci.EntityFields.ID];
            delete doc[sci.EntityFields.ID];
            doc = new EntityModel(doc);
            doc[sci.EntityFields.ACCOUNT_ID] = userId; // Assign user id
            doc.save(function (err, doc) {
                if (err) {
                    return callback(err);
                }
                change[sci.EntityFields.ID] = doc._id; // Assign server generated ID
                finalResult.created.push(toSyncResult(doc.toObject()));
                callback();
            });
        }

        /**
         * Update existing entities from client changes
         * @param doc {*} db entity
         * @param change {*} changed entity
         * @param callback {Function(Error)} used for sync call
         */
        function _updateFromClient(doc, change, callback) {
            if (change[sci.EntityFields.LAST_MODIFIED] > doc[sci.EntityFields.LAST_MODIFIED]) {
                _.assign(doc, change);
                //_updateLmt(doc);
                doc.save(function (err) {
                    if (err) {
                        return callback(err);
                    }
                    finalResult.updated.push(toSyncResult(change));
                    callback();
                });
            } else {
                _rejectChange(change, "SeverChangedAfterClient", {
                        server: doc[sci.EntityFields.LAST_MODIFIED]
                    }
                );
                callback();
            }
        }

        async.each(changes, function (change, callback) {
            var entityId = change[sci.EntityFields.ID];
            var status = change[sci.EntityFields.STATUS];
            var isCid = isClientId(entityId);
            //logger.debug("callbackFunc", status, entityId, clientOnly);
            if (status == sci.EntityStatus.DELETED) {
                if (!isCid) {
                    // Delete entity from server
                    EntityModel.remove({_id: entityId}, function (err) {
                        if (err) {
                            return callback(err);
                        }
                        finalResult.deleted.push({_id: entityId});
                        auditor.log("delete", EntityModel.modelName, entityId);
                        callback();
                    });
                } else {
                    _rejectChange(change, "DeletedEntityIsClientOnly");
                    callback();
                }
            } else if (isCid) {
                // Entity with client type ID has two possibilities:
                // 1. the entity is really NEW to server
                // 2. the entity has been previously synced creation on server but failed syncing server ID back to client
                // So we try to lookup and update server entity first. If not found then create a new one.
                var q = {};
                q[sci.EntityFields.CLIENT_ID] = entityId;
                EntityModel.findOne(q).exec(function (err, doc) {
                    if (err) {
                        callback(err);
                    } else if (doc) {
                        _updateFromClient(doc, change, callback);
                    } else {
                        _createFromClient(change, callback);
                    }
                })
            } else {
                // Entity with server type ID, try update it
                var query = {};
                query[sci.EntityFields.ID] = entityId;
                query[sci.EntityFields.ACCOUNT_ID] = userId;
                // We look up existing entity by its id and owner to ensure that the creator is the passed in user.
                EntityModel.findOne(query, function (err, doc) {
                    if (err) {
                        return callback(err);
                    } else if (doc) {
                        _updateFromClient(doc, change, callback);
                    } else {
                        if (options.forceCreationIfNotFound) {
                            _createFromClient(change, callback);
                        } else {
                            // The entity may have been deleted from server so we cannot find it
                            _rejectChange(change, "ModifiedEntityNotFound");
                            callback();
                        }
                    }
                });
            }
        }, function (err) {
            if (err) return d.reject(err);
            d.resolve(finalResult);
        });
        return d.promise;
    }

    /**
     * Find changes on server side.
     * @param lmt {Number} as Date
     * @param fields
     * @return {Q<{modified:[Object],deleted:[{_id:String,timestamp:Number}]}>}
     */
    function findServerChanges(lmt, fields) {
        var d = Q.defer();
        var result = {modified: [], deleted: []};
        var queryAfterLmt = {};
        if (lmt) {
            queryAfterLmt[sci.EntityFields.LAST_MODIFIED] = {$gt: Number.parseInt(lmt)};
        }
        EntityModel.find(queryAfterLmt).select(fields).exec(function (err, records) {
            if (err) {
                return d.reject(err);
            }
            records.forEach(function (record) {
                result.modified.push(record.toObject());
            });
            var queryDeleted = {action: "delete", entity: EntityModel.modelName};
            if (lmt) {
                queryDeleted.timestamp = {$gt: lmt};
            }
            AuditModel.find(queryDeleted).exec(function (err, docs) {
                if (err) {
                    return d.reject(err);
                }
                docs.forEach(function (doc) {
                    var obj = {_id: doc.entityId, timestamp: doc.timestamp};
                    result.deleted.push(obj);
                });
                d.resolve(result);
            });
        });
        return d.promise;
    }

    /**
     * Find one entity
     * @param condition
     * @returns {Promise<Object>}
     */
    function findOne(condition) {
        var d = Q.defer();
        EntityModel.findOne(condition).exec(function (err, doc) {
            if (err) {
                d.reject(err);
            } else {
                d.resolve(doc ? doc.toObject() : doc);
            }
        });
        return d.promise;
    }

    /**
     * Find an existing entity, or create a new one if entity not found
     * @param condition
     * @param entity
     * @returns {promise<Object>}
     */
    function findOrCreate(condition, entity) {
        var d = Q.defer();
        EntityModel.findOne(condition).exec(function (err, rec) {
            if (err)
                d.reject(err);
            else {
                if (rec) {
                    logger.debug(rec.toObject(), "findOrCreate.found");
                    d.resolve(rec.toObject());
                } else {
                    var model = new EntityModel(entity);
                    model.save(function (err, rec) {
                        if (err) {
                            d.reject(err);
                        } else {
                            logger.debug(rec.toObject(), "findOrCreate.create");
                            d.resolve(rec.toObject());
                        }
                    });
                }
            }
        });
        return d.promise;
    }

    /**
     *
     * @param query {Object}
     * @param filter {{sort:*,limit:Number}}
     * @returns {Q<{total:Number,records:[]}>}
     */
    function findByQuery(query, filter) {
        var deferred = Q.defer();
        var result = {total: 0, records: []};
        //logger.debug("findByQuery", conditions);
        EntityModel.count(query, function (err, num) {
            result.total = num;
            EntityModel.find(query/*, {'attachment.data': 0, 'attachment.thumbnail': 0}*/)
                .sort(filter ? filter.sort : null)
                .limit(filter ? filter.limit : null)
                .exec(function (err, docs) {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        result.records = docs;
                        deferred.resolve(result);
                    }
                });
        });
        return deferred.promise;
    }

    /**
     *
     * @param db {*} target
     * @param input {*} src
     */
    function _assignProperties(db, input) {
        var prop = modelPrototype || input;
        Object.keys(prop).forEach(function (t) {
            db[t] = input[t];
        });
    }

    /**
     *
     * @param id
     * @param successCallback
     * @param errorCallback
     */
    function findById(id, successCallback, errorCallback) {
        var deferred = Q.defer();
        EntityModel.findOne({_id: id}, {}, function (err, doc) {
            if (err) {
                deferred.reject(err);
                errorCallback(err);
            } else {
                deferred.resolve(doc);
                successCallback && successCallback(doc);
            }
        });
        return deferred.promise;
    }

    /**
     * Update an entity. It will fetch entity from database first then assign input value to the database item.
     * @param entity {Object}
     * @returns {Q<{}>} Updated document
     */
    function updateEntity(entity) {
        var deferred = Q.defer();
        EntityModel.findOne({_id: entity[sci.EntityFields.ID]}, function (err, doc) {
            if (err) {
                return errorCallback(err);
            }
            _assignProperties(doc, entity);
            _updateLmt(doc);
            doc.save(function (err, doc) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(doc);
                }
            });
        });
        return deferred.promise;
    }

    /**
     * Create an entity
     * @param entity {BaseModel}
     * @return {Q<{}>} Created document
     */
    function createEntity(entity) {
        var d = Q.defer();
        //No need to generate ID by manual. Be caution, do not define property of bmb.EntityFields.ID in BaseModel
        //http://stackoverflow.com/questions/17899750/how-can-i-generate-an-objectid-with-mongoose
        //entity[bmb.EntityFields.ID] = shortid.generate();//mongoose.Types.ObjectId();
        var model = new EntityModel(entity);
        _updateLmt(model);
        model.save(function (err, doc) {
            if (err) {
                d.reject(err);
            } else {
                d.resolve(doc);
            }
        });
        return d.promise;
    }

    /**
     *
     * @param id {[string]} array or string of entity id
     * @return {Q<Number>} Count of removed documents
     */
    function deleteEntity(id) {
        var deferred = Q.defer();
        var ids = [];
        if (typeof id == "string") {
            ids.push(id);
        } else {
            ids = id;
        }
        EntityModel.remove({_id: {$in: ids}}, function (err, countOfRemoved) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(countOfRemoved);
                auditor.log("delete", EntityModel.modelName, ids);
            }
        });
        return deferred.promise;
    }

    return {
        saveClientChanges: saveClientChanges,
        findServerChanges: findServerChanges,
        findByQuery: findByQuery,
        findById: findById,
        findOne: findOne,
        findOrCreate: findOrCreate,
        updateEntity: updateEntity,
        deleteEntity: deleteEntity,
        createEntity: createEntity
    };
}

var db = {
    BaseEntityService: EntityDao,
    mongoModel: mongoModel
};
module.exports = db;

