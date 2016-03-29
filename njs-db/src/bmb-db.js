/*!
 * Server side API.
 */
var _ = require('lodash');
var async = require('async');
var mongoose = require('mongoose');
var Q = require("q");
var bmb = require('./bmb-sci');
var shortid = require('shortid');

var logger = require('bunyan').createLogger({name: "bmb-db", level: 'debug'});

/**
 * Update entity's last modified time to current timestamp
 * @param entity {Object}
 * @private
 */
function _updateLmt(entity) {
    entity[bmb.EntityFields.LAST_MODIFIED] = bmb.utcTimestamp();
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
        fields[bmb.EntityFields.CLIENT_ID] = String;
        fields[bmb.EntityFields.LAST_MODIFIED] = Number;
        fields[bmb.EntityFields.ACCOUNT_ID] = String;
        fields[bmb.EntityFields.STATUS] = String;
    }
    return mongoose.model(name, mongoose.Schema(fields));
}

var AuditModel = mongoose.model('Audit', mongoose.Schema({
    _id: {
        type: String,
        unique: true,
        'default': shortid.generate
    },
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
    audit.timestamp = bmb.utcTimestamp();
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
        var queue = [
            function (callback) {
                callback(null, changes, 0);
            }
        ];
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
         * @param extra {*=} Extra information saved in property `extra`
         * @returns {{}}
         */
        function toSyncResult(entity, extra) {
            var obj = {};
            obj[bmb.EntityFields.CLIENT_ID] = entity[bmb.EntityFields.CLIENT_ID];
            obj[bmb.EntityFields.ID] = entity[bmb.EntityFields.ID];
            obj[bmb.EntityFields.STATUS] = entity[bmb.EntityFields.STATUS];
            obj[bmb.EntityFields.LAST_MODIFIED] = entity[bmb.EntityFields.LAST_MODIFIED];
            if (extra)
                obj.extra = extra;
            return obj;
        }

        function _rejectChange(entity, reason, callback, currentIndex) {
            var obj = toSyncResult(entity, reason);
            finalResult.rejected.push(obj);
            callback(null, finalResult, currentIndex + 1);
        }

        /**
         * Create new entities from client changes
         * @param change
         * @param callback
         * @param currentIndex
         */
        function syncNewEntity(change, callback, currentIndex) {
            change[bmb.EntityFields.CLIENT_ID] = change[bmb.EntityFields.ID];
            delete change[bmb.EntityFields.ID];
            var doc = new EntityModel(change);
            doc[bmb.EntityFields.ACCOUNT_ID] = userId; // Assign user id
            //_updateLmt(doc);
            doc.save(function (err, doc) {
                if (err) {
                    handleError(err);
                } else {
                    change[bmb.EntityFields.CLIENT_ID] = change[bmb.EntityFields.ID]; // Save old client ID
                    change[bmb.EntityFields.ID] = doc._id; // Assign server generated ID
                    finalResult.created.push(toSyncResult(doc));
                }
                callback(null, finalResult, currentIndex + 1);
            });
        }

        /**
         * Update existing entities from client changes
         * @param doc {*} db entity
         * @param change {*} changed entity
         * @param callback {Function} used for sync call
         * @param currentIndex {Number} used for sync call
         */
        function syncExistingEntity(doc, change, callback, currentIndex) {
            if (change[bmb.EntityFields.LAST_MODIFIED] > doc[bmb.EntityFields.LAST_MODIFIED]) {
                _.assign(doc, change);
                //_updateLmt(doc);
                doc.save(function (err) {
                    if (err) {
                        handleError(err);
                    } else {
                        finalResult.updated.push(toSyncResult(change));
                    }
                    callback(null, finalResult, currentIndex + 1);
                });
            } else {
                _rejectChange(change, {
                    msg: "EarlyLmt",
                    server: doc[bmb.EntityFields.LAST_MODIFIED]
                }, callback, currentIndex);
            }
        }

        var callbackFunc = function (prevModelData, currentIndex, callback) {
            var change = changes[currentIndex];
            var entityId = change[bmb.EntityFields.ID];
            var status = change[bmb.EntityFields.STATUS];
            var isCid = isClientId(entityId);
            //logger.debug("callbackFunc", status, entityId, clientOnly);
            if (status == bmb.EntityStatus.DELETED && !isCid) {
                // Delete entity from server
                EntityModel.remove({_id: entityId}, function (err) {
                    if (err) {
                        handleError(err);
                    } else {
                        finalResult.deleted.push({_id: entityId});
                        auditor.log("delete", EntityModel.modelName, entityId);
                    }
                    callback(null, finalResult, currentIndex + 1);
                });
            } else if (status != bmb.EntityStatus.DELETED && isCid) {
                // Entity with client type ID has two possibilities:
                // 1. the entity is real NEW to server
                // 2. the entity has been previously synced creation on server but failed syncing server ID back to client
                // So we try to lookup and update server entity first. If not found then create a new one.
                var q = {};
                q[bmb.EntityFields.CLIENT_ID] = entityId;
                EntityModel.findOne(q).exec(function (err, doc) {
                    if (err) {
                        handleError(err);
                    } else if (doc) {
                        syncExistingEntity(doc, change, callback, currentIndex);
                    } else {
                        syncNewEntity(change, callback, currentIndex);
                    }
                })
            } else if (status != bmb.EntityStatus.DELETED && !isCid) {
                // Entity with server type ID, try update it
                var query = {};
                query[bmb.EntityFields.ID] = entityId;
                query[bmb.EntityFields.ACCOUNT_ID] = userId;
                // We look up existing entity by its id and owner to ensure that the creator is the passed in user.
                EntityModel.findOne(query, function (err, doc) {
                    if (err) {
                        handleError(err);
                    } else if (doc) {
                        syncExistingEntity(doc, change, callback, currentIndex);
                    } else {
                        if (options.forceCreationIfNotFound) {
                            syncNewEntity(change, callback, currentIndex);
                        } else {
                            // The entity may have been deleted from server so we cannot find it
                            _rejectChange(change, "ModifiedEntityNotFound", callback, currentIndex);
                        }
                    }
                });
            } else {
                _rejectChange(change, "InconsistentStatus", callback, currentIndex);
            }
        };
        _.forEach(changes, function () {
            queue.push(callbackFunc);
        });

        async.waterfall(queue, function (err, result) {
            if (err) return d.reject(err);
            d.resolve(finalResult);
        });
        return d.promise;
    }

    /**
     * Find changes on server side.
     * @param lmt {Date}
     * @param fields
     * @return {Q<{modified:[Object],deleted:[{_id:String,timestamp:Number}]}>}
     */
    function findServerChanges(lmt, fields) {
        var d = Q.defer();
        var result = {modified: [], deleted: []};
        var query = {};
        query[bmb.EntityFields.LAST_MODIFIED] = {$gt: lmt};
        EntityModel.find(query).select(fields).exec(function (err, records) {
            if (err) return d.reject(err);
            records.forEach(function (record) {
                result.modified.push(record.toObject());
            });
            var criteria = {action: "delete", entity: EntityModel.modelName, timestamp: {$gt: lmt}};
            AuditModel.find(criteria).exec(function (err, docs) {
                if (err) return d.reject(err);
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
        EntityModel.findOne({_id: entity[bmb.EntityFields.ID]}, function (err, doc) {
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

