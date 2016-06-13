/*!
 * Client side data operations.
 */

(function checkDependency() {
    if (!ydn) {
        alert("Need YDN-DB https://dev.yathit.com");
    }
})();


(function locs_ng_data() {
    window.bmb = window.bmb || {};
    bmb.client = bmb.client || {};
    /**
     * Configuration of local data access.
     * @param localStores {[LocalStore]}
     * @param dbName {String} Name of local db
     * @constructor
     */
    bmb.client.LocalDataConfig = function (dbName, localStores) {
        this._localStores = [];
        var _ydnDb = null;
        var that = this;
        // Built-in store for settings
        var settingsStore = new bmb.client.LocalStore({name: "_settings", keyPath: "__key"}, null, "");
        this._localStores.push(settingsStore);

        localStores.forEach(function (store) {
            if (store instanceof bmb.client.LocalStore) {
                that.addLocalStore(store);
            } else {
                throw new TypeError("Store must be an instance of bmb.client.LocalStore " + JSON.stringify(store));
            }
        });

        /**
         * Native local db
         * @return {ydn.db.Storage}
         */
        this.getDb = function () {
            if (!_ydnDb) {
                var _ydnStores = [];
                this._localStores.forEach(function (ls) {
                    _ydnStores.push(ls.ydnStore);
                });
                console.info("Initialize DB [" + dbName + "] with " + _ydnStores.length + " stores");
                _ydnDb = new ydn.db.Storage(dbName, {stores: _ydnStores});
            }
            return _ydnDb;
        };
    };
    /**
     * Local store for application settings.
     * @return {{name: string, keyPath: string}}
     */
    bmb.client.LocalDataConfig.prototype.getSettingsStore = function () {
        return {
            name: "_settings",
            keyPath: "__key"
        };
    };

    /**
     * Get names of all local stores
     * @returns {[{name:string}]}
     */
    bmb.client.LocalDataConfig.prototype.allLocalStores = function () {
        var result = [];
        this._localStores.forEach(function (store) {
            result.push({name: store.storeName});
        });
        return result;
    };

    /**
     *
     * @param localStore {LocalStore}
     */
    bmb.client.LocalDataConfig.prototype.addLocalStore = function (localStore) {
        this._localStores.push(localStore);
    };

    /**
     * Get store definition by store name
     * @param storeName {string} store name
     * @return {LocalStore}
     */
    bmb.client.LocalDataConfig.prototype.getLocalStore = function (storeName) {
        return _.find(this._localStores, function (store) {
            return store.storeName == storeName;
        });
    };

    /**
     * Configuration of remote data access.
     * @param remoteStores {[RemoteStore]}
     * @constructor
     */
    bmb.client.RemoteDataConfig = function (remoteStores, serverBaseUrl) {
        this.getRemoteStore = function (storeName) {
            return _.find(remoteStores, function (store) {
                return store.storeName == storeName;
            });
        };
        this.serverBaseUrl = serverBaseUrl;
    };
    /**
     * A local data store is like a table in database. We use YDN-DB library.
     * @param ydnStore {{name:String,keyPath:String,indexes:[{name:String,keyPath:String}]=}} YDN store definition,
     * @param modelPrototype {object|function()} prototype of entity. It will be assigned to entity's <tt>__proto__</tt>.
     * Use this parameter to add model defined methods to data entities.
     * If this parameter is a function, it will take entity as parameter.
     * @param fields {*|function} Fields to be persisted, key as field name, value as field data type. Value is NOT used now.
     * It supports dynamic fields by providing a function. The function takes entity as parameter.
     * @see http://dev.yathit.com/ydn-db/doc/setup/schema.html
     * @constructor
     */
    bmb.client.LocalStore = function (ydnStore, modelPrototype, fields) {
        /**
         *
         * @type {string}
         */
        this.storeName = ydnStore.name;

        this.indexes = [];
        /**
         * Model fields to be persisted
         * @type {*|Function}
         */
        this.fields = fields;
        /**
         *
         * @type {Object}
         */
        this.modelPrototype = modelPrototype;
        /**
         *
         * @type {{name: string, keyPath: string}}
         */
        this.ydnStore = ydnStore;

    };

    /**
     * Define a remote data resource
     * @param storeName
     * @param modelPrototype {*} the prototype of model
     * @param restDataSource {RestDataSource}
     * @constructor
     */
    bmb.client.RemoteStore = function (storeName, modelPrototype, restDataSource) {
        this.storeName = storeName;
        this.restDataSource = restDataSource;
        this.modelPrototype = modelPrototype;
    };

    /**
     * Definition of a RESTful data source.
     * @param url {string} A parametrized URL template with parameters prefixed by : as in `/user/:username`.
     * If you are using a URL with a port number (e.g. `http://example.com:8080/api`), it will be respected.
     * @param paramDefaults {*} Default values for url parameters. These can be overridden in actions methods.
     * @param actions {*} Hash with declaration of custom action that should extend the default set of resource actions.
     * @param options {*} Hash with custom settings that should extend the default $resourceProvider behavior.
     * @constructor
     */
    bmb.client.RestDataSource = function (url, paramDefaults, actions, options) {
        this.url = url;
        this.paramDefaults = paramDefaults;
        this.actions = actions;
        this.options = options;
    };

    /**
     * Assign prototype to an entity
     * @param entity
     */
    bmb.client.LocalStore.prototype.assignPrototype = function (entity) {
        bmb.client.setPrototype(entity, this.modelPrototype);
    };


    /**
     * Get fields to be persisted
     * @param entity {*}
     * @return [String]
     */
    bmb.client.LocalStore.prototype.persistentFields = function (entity) {
        var fields = this.fields;
        if (angular.isFunction(this.fields)) {
            fields = this.fields(entity);
        }
        if (!fields) {
            return [];
        } else if (angular.isArray(fields)) {
            return fields;
        } else if (typeof fields == "string") {
            return fields.split(",");
        } else if (angular.isObject(fields)) {
            return Object.keys(fields);
        } else {
            throw new Error("Invalid fields definition: " + JSON.stringify(fields));
        }
    };
    /**
     * Returns a ngResource object
     * @param $resource
     * @returns {{get:function,save:function,query:function,remove:function,delete:function}} A resource "class" object with methods for the default set of resource actions optionally extended with custom actions.
     */
    bmb.client.RestDataSource.prototype.toNgResource = function ($resource) {
        return $resource(this.url, this.paramDefaults, this.actions, this.options);
    };

    /**
     * Set prototype for an object.
     * @param entity
     * @param prototype
     */
    bmb.client.setPrototype = function (entity, prototype) {
        var proto = prototype;
        if (entity && prototype) {
            if (angular.isFunction(prototype)) {
                proto = prototype(entity);
            }
            entity.__proto__ = proto;
            var initFn = entity.__initialize;
            if (angular.isFunction(initFn)) {
                initFn.call(entity);
            }
        }
    };
})();

(function bmc_dao(module) {
    'use strict';

    /**
     *
     * @param entity {*}
     * @param timestamp {Date=}
     */
    function updateEntityLmt(entity, timestamp) {
        var t;
        if (timestamp)
            t = timestamp;
        else
            t = bmb.sci.utcTimestamp();
        entity[bmb.sci.EntityFields.LAST_MODIFIED] = t;//bmb.sci.utcTimestamp(timestamp);
    }

    /**
     * Provides generic storage access functionality.
     * @param localStore {LocalStore}
     * @param $q {$q} angular promise service
     * @param ydnDb {ydn.db.Storage | AppDef} AppDef type is deprecated
     * @constructor
     */
    function LocalDao(localStore, ydnDb, $q) {
        /**
         *
         * @type {LocalStore}
         * @private
         */
        this._localStore = localStore;
        /**
         * @type {String}
         */
        this._storeName = this._localStore.storeName;
        this._db = ydnDb;
        this._$q = $q;
    }

    LocalDao.prototype = {
        /**
         * Generate id for new entity
         * @returns {string}
         * @private
         */
        _nextId: function () {
            return bmb.sci.LOCAL_ID_PREFIX + (new Date().getTime());
        },

        /**
         * Create a copy of entity with only persistent fields defined in local store.
         * If no persistent fields defined, it simply returns the entity.
         * @param entity {*}
         * @returns {{}} A copy with only persistent fields.
         * @private
         */
        _copyPersistentValues: function (entity) {
            var fields = this._localStore.persistentFields(entity);
            //console.debug("copyPfields", fields);
            if (fields.length == 0)
                return entity;
            var cloned = {};
            fields.forEach(function (field) {
                if (entity[field]) {
                    cloned[field] = entity[field];
                }
            });
            return cloned;
        },
        /**
         * Clear data from its underlined local store, used when logout
         * @param successCallback {function=}
         */
        clearLocalData: function (successCallback) {
            this._db.clear(this._storeName).done(successCallback && successCallback());
        },
        /**
         * Find soft deleted entities
         * @returns {{total: number, records: Array}}
         */
        findDeletedEntity: function () {
            var deferred = this._$q.defer();
            var result = {total: 0, records: []};
            var q = this._db.from(this._storeName).where(bmb.sci.EntityFields.STATUS, '=', bmb.sci.EntityStatus.DELETED);
            q.list().done(function (records) {
                records.forEach(function (record) {
                    result.records.push(record);
                });
                deferred.resolve(records);
            }).fail(function (err) {
                deferred.reject(err);
            });
            result.$promise = deferred.promise.then();
            return result;
        },
        /**
         * Save changes from server
         * @param modified {[]}
         * @return {$q<{updated: [], created: [], deleted: [], rejected: [], unprocessed: []}>} Server changes processed by local
         */
        saveServerChanges: function (modified) {
            var that = this;
            var d = that._$q.defer();
            var finalResult = {updated: [], created: [], deleted: [], rejected: [], unprocessed: []};
            _saveServerUpdatedAndDeleted(modified).then(function (result) {
                finalResult.updated = result.updated;
                finalResult.rejected = result.rejected;
                finalResult.deleted = result.deleted;
                return _saveServerCreated(result.unprocessed);
            }).then(function (result) {
                finalResult.created = result.created;
                finalResult.unprocessed = result.unprocessed;
                d.resolve(finalResult);
            }).catch(function (err) {
                d.reject(err);
            });
            return d.promise;

            /**
             * Save server changes of updated and deleted entities
             * @param changes
             * @returns {$q<{updated:[],rejected:[],deleted:[],unprocessed:[]}>}
             */
            function _saveServerUpdatedAndDeleted(changes) {
                var d = that._$q.defer();
                var db = that._db;
                var it = new ydn.db.ValueIterator(that._storeName);
                var result = {updated: [], rejected: [], deleted: [], unprocessed: changes};
                db.open(function next(cursor) {
                    var dbRec = cursor.getValue();
                    var dbRecId = dbRec[bmb.sci.EntityFields.ID];
                    for (var i = changes.length - 1; i >= 0; i--) {
                        var change = changes[i];
                        if (dbRecId == change[bmb.sci.EntityFields.ID]) {
                            // If local entity has server ID, we can update or delete it directly, then mark the change has been processed.
                            result.unprocessed.splice(i, 1);
                            //console.debug("Remove unprocessed",change);
                            if (change[bmb.sci.EntityFields.STATUS] == bmb.sci.EntityStatus.DELETED) {
                                // If the change is a delete operation
                                result.deleted.push(change);
                                cursor.clear();
                            } else if (dbRec[bmb.sci.EntityFields.LAST_MODIFIED] < change[bmb.sci.EntityFields.LAST_MODIFIED]) {
                                //} else if (true) {
                                dbRec = that._copyPersistentValues(change);
                                result.updated.push(change);
                                //_.assign(dbRec, change);
                                dbRec[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.SYNCED;
                                //console.debug("saveServerChanges.update", dbRec, change);
                                cursor.update(dbRec);
                            } else {
                                var obj = {};
                                [bmb.sci.EntityFields.ID, bmb.sci.EntityFields.STATUS, bmb.sci.EntityFields.STATUS, bmb.sci.EntityFields.LAST_MODIFIED].forEach(function (key) {
                                    obj[key] = change[key];
                                });
                                obj.reason = "ClientChangedAfterServer";
                                result.rejected.push(obj);
                            }
                        } else if (dbRecId == change[bmb.sci.EntityFields.CLIENT_ID]) {
                            // If local entity has no server ID (only match client ID), remove it from local first
                            // then create a new entity in local later
                            // YDN cursor cannot alter entity ID
                            // Keep the change as unprocessed because we need create in local later
                            cursor.clear();
                        }
                    }
                }, it, "readwrite").done(function () {
                    d.resolve(result);
                });
                return d.promise;
            }

            /**
             *
             * Save server changes of created entities
             * @param changes
             * @returns {$q<{created:[],unprocessed:[]}>}
             */
            function _saveServerCreated(changes) {
                var result = {created: [], unprocessed: changes};
                var d = that._$q.defer();
                for (var i = changes.length - 1; i >= 0; i--) {
                    var change = changes[i];
                    if (change[bmb.sci.EntityFields.STATUS] != bmb.sci.EntityStatus.DELETED) {
                        result.unprocessed.splice(i, 1);
                        result.created.push(change);
                        change[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.SYNCED;
                        delete change[bmb.sci.EntityFields.CLIENT_ID];
                        that.rawSave(change);
                    }
                }
                d.resolve(result);
                return d.promise;
            }
        },
        /**
         * Mark records status as SYNCED.
         * @param processed {{created:[],updated:[],deleted:[],rejected:[]}}
         */
        markLocalChangesSynced: function (processed) {
            var that = this;
            processed.updated.forEach(function (item) {
                that.findEntityById(item[bmb.sci.EntityFields.ID]).then(function (doc) {
                    if (doc) {
                        doc[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.SYNCED;
                        //updateEntityLmt(doc, item[bmb.sci.EntityFields.LAST_MODIFIED]);
                        that.rawSave(doc);
                    }
                })
            });
            processed.created.forEach(function (item) {
                that.findEntityById(item[bmb.sci.EntityFields.CLIENT_ID]).then(function (doc) {
                    if (doc) {
                        doc[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.SYNCED;
                        doc[bmb.sci.EntityFields.CLIENT_ID] = item[bmb.sci.EntityFields.CLIENT_ID];
                        doc[bmb.sci.EntityFields.ID] = item[bmb.sci.EntityFields.ID];
                        //updateEntityLmt(doc, item[bmb.sci.EntityFields.LAST_MODIFIED]);
                        that.rawSave(doc);
                    }
                })
            });
        },
        /**
         * Find local changes including new, modified, deleted entities.
         * Entities whose last modified timestamp greater than specified timestamp
         * or whose status is not bmb.sci.EntityStatus.SYNCED are considered as changes.
         * @param timestamp {Number|Date} timestamp
         * @returns {$q<{changes: []}>} a promise object
         */
        findLocalChanges: function (timestamp) {
            var d = this._$q.defer();
            timestamp = timestamp || 0;
            var result = {changes: []};
            var db = this._db;
            var it = new ydn.db.ValueIterator(this._storeName);
            // Use open() or scan() since list() will limit number of result
            db.open(function (cursor) {
                var record = cursor.getValue();
                var recordLmt = record[bmb.sci.EntityFields.LAST_MODIFIED];
                if ((timestamp && recordLmt > timestamp)
                    || record[bmb.sci.EntityFields.STATUS] != bmb.sci.EntityStatus.SYNCED) {
                    //if (record[bmb.sci.EntityFields.LAST_MODIFIED] > timestamp) {
                    result.changes.push(record);
                    //console.debug("findLocalChanges", record);
                }
                //var props = [bmb.sci.EntityFields.ID, bmb.sci.EntityFields.LAST_MODIFIED];
                //var obj = {};
                //props.forEach(function (prop) {
                //    obj[prop] = record[prop];
                //});
            }, it, "readonly").done(function () {
                d.resolve(result);
            }).fail(function (err) {
                d.reject(err);
            });
            return d.promise;
        },

        /**
         * Query with pagination. It finds all entities except those soft deleted.
         * Instead of returning a simple promise object in common asynchronous calling,
         * this method simulate angular $resource to return immediately an empty result
         * `{total:0, records:[]}` with property `$promise`.
         * After the query completed, the result will be filled with actual data.
         * Returning a data structure is more intuitionistic than a promise.
         * http://blog.mgechev.com/2014/02/05/angularjs-resource-active-record-http/
         * @param query {string=} NOT USED
         * @param successCallback {function({Array})=} with parameter result in specified page
         * @param errorCallback {function(Error)=}
         * @returns {$q<{total: number, records: []}>} `records` is result in specified page
         */
        findAllEntity: function (query, successCallback, errorCallback) {
            var d = this._$q.defer();
            var that = this;
            var result = {total: 0, records: []};
            var it = ydn.db.IndexIterator.where(this._storeName, bmb.sci.EntityFields.STATUS, '>', bmb.sci.EntityStatus.DELETED);
            that._db.count(it).done(function (num) {
                result.total = num;
                that._db.from(that._storeName).where(bmb.sci.EntityFields.STATUS, '>', bmb.sci.EntityStatus.DELETED).list()
                    .done(function (records) {
                        records.forEach(function (record) {
                            that._localStore.assignPrototype(record);
                            result.records.push(record);
                        });
                        d.resolve(result);
                        successCallback && successCallback(records);
                    }).fail(function (err) {
                    d.reject(err);
                    errorCallback && errorCallback(err);
                });
            });
            return d.promise;
            //
            ////http://blog.mgechev.com/2014/02/05/angularjs-resource-active-record-http/
            //result.$promise = deferred.promise.then(function (data) {
            //    result.total = data.total;
            //    result.records = data.records;
            //});
            //return result;
        },
        /**
         * Create new entity
         * @param entity {bmb.BaseModel}
         */
        createEntity: function (entity) {
            updateEntityLmt(entity);
            entity[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.NEW;
            return this.rawSave(entity);
        },
        /**
         * Save entity's persistent fields as is.
         * It will generate a new id if no id specified.
         * @param entity {bmb.BaseModel} passed by reference and will be updated
         * @param successCallback {function(string, bmb.BaseModel)=} parameter effected entity id, entity
         * @param errorCallback {function(Error)=}
         * @return {$q<String>} Effected entity ID
         */
        rawSave: function (entity, successCallback, errorCallback) {
            var d = this._$q.defer();
            var db = this._db;
            entity[bmb.sci.EntityFields.ID] = entity[bmb.sci.EntityFields.ID] || this._nextId();
            var cloned = this._copyPersistentValues(entity);
            db.put({name: this._storeName}, cloned).done(function (id) {
                d.resolve(id);
                successCallback && successCallback(id, cloned);
            }).fail(function (err) {
                d.reject(err);
                errorCallback && errorCallback(err);
            });
            return d.promise;
        },
        /**
         * Find entity by id.
         * @param entityId {string}
         * @param successCallback {function(BaseModel)=} parameter entity
         * @param errorCallback {function(Error)=}
         * @returns {$q<Object>} Value of entity
         */
        findEntityById: function (entityId, successCallback, errorCallback) {
            var d = this._$q.defer();
            //var result = {};
            var that = this;
            this._db.get(this._storeName, entityId)
                .done(function (doc) {
                    //angular.extend(result, doc);
                    that._localStore.assignPrototype(doc);
                    //console.debug("findEntityById", result);
                    d.resolve(doc);
                    successCallback && successCallback(doc);
                }).fail(function (err) {
                d.reject(err);
                errorCallback && errorCallback(err);
            });
            //result.$promise = d.promise.then();
            return d.promise;
        },
        /**
         * Update specified properties of an entity. It uses current timestamp as last modified.
         * @param entityId {string}
         * @param props {{}} properties to update in name-value pairs
         * @param successCallback {function(string,bmb.BaseModel)} parameter effected entity id, entity
         * @param errorCallback
         */
        updateProperty: function (entityId, props, successCallback, errorCallback) {
            var that = this;
            this.findEntityById(entityId, function (entity) {
                if (!entity) {
                    throw new Error("Cannot find entity " + entityId);
                }
                if (props) {
                    angular.extend(entity, props);
                }
                entity[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.MODIFIED;
                updateEntityLmt(entity);
                that.rawSave(entity, successCallback);
            });
        },
        /**
         * Update entity.
         * @param entity
         * @param successCallback {function(string,bmb.BaseModel)} parameter effected entity id, entity
         * @param errorCallback
         */
        updateEntity: function (entity, successCallback, errorCallback) {
            var that = this;
            that.updateProperty(entity[bmb.sci.EntityFields.ID], entity, successCallback, errorCallback);
        },
        /**
         * Use this method in case the entity ID need be changed with update.
         * @param entityId {string} existing entity id
         * @param entity {bmb.BaseModel} with new id
         */
        updateEntityWithId: function (entityId, entity) {
            // Since ydn cannot change key, we delete and create
            var that = this;
            that.deleteEntity(entityId, false, function () {
                that.rawSave(entity, false, null, null);
            }, null);
        },
        purgeDeletedEntity: function (successCallback) {
            console.debug("purgeDeleteEntity");
            this._db.remove(this._storeName, bmb.sci.EntityFields.STATUS, ydn.db.KeyRange.only(bmb.sci.EntityStatus.DELETED))
                .done(successCallback);
        },
        /**
         * Mark entity as deleted.
         * @param entityId {string|[string]} single or array of entity id
         * @param softDelete {boolean} true to make status as deleted but without actual deletion, default is false
         * @return {$q<>}
         */
        deleteEntity: function (entityId, softDelete) {
            var d = this._$q.defer();
            var db = this._db;
            var that = this;
            var ids = [];
            if (angular.isArray(entityId)) {
                ids = entityId;
            } else {
                ids.push(entityId);
            }
            if (softDelete) {
                db.values(this._storeName, ids).done(function (entities) {
                    entities.forEach(function (entity) {
                        entity[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.DELETED;
                        updateEntityLmt(entity);
                    });
                    db.put(that._storeName, entities).done(function (doc) {
                        d.resolve();
                    }).fail(function (err) {
                        d.reject(err);
                    });
                    d.resolve();
                });
            } else {
                ids.forEach(function (id) {
                    db.remove(that._storeName, ydn.db.KeyRange.only(id)).done(function (num) {
                        console.debug(num + " records removed from db");
                    });
                });
                d.resolve();
            }
            return d.promise;
        }
    };
    /**
     * Note on resource
     * https://docs.angularjs.org/api/ngResource/service/$resource
     * The action methods on the class object or instance object can be invoked with the following parameters:
     * •HTTP GET "class" actions: Resource.action([parameters], [success], [error])
     * •non-GET "class" actions: Resource.action([parameters], postData, [success], [error])
     * •non-GET instance actions: instance.$action([parameters], [success], [error])
     * Success callback is called with (value, responseHeaders) arguments. Error callback is called with (httpResponse) argument.
     * Class actions return empty instance (with additional properties below). Instance actions return promise of the action.
     *
     * @param entityResource {*} ngResource
     * @param modelPrototype {*}
     * @constructor
     */
    function RemoteDao(entityResource, modelPrototype) {
        this._resource = entityResource;
        this._modelPrototype = modelPrototype;
    }

    RemoteDao.prototype = {
        /**
         * Find by query
         * @param options query options
         * @returns {*}
         */
        findAllEntity: function (options) {
            return this._resource.query(options);
        },
        /**
         * Create an entity
         * @param entity
         * @param successCallback after create
         * @param errorCallback {function({data:{},status:number,headers:function, config:{}})} with parameter httpResponse
         */
        createEntity: function (entity, successCallback, errorCallback) {
            console.debug("createEntity", entity);
            var modal = new this._resource(entity);
            return modal.$save();
            //return this._resource.save(entity, null, successCallback, errorCallback);
        },

        deleteEntity: function (entityId, softDelete, successCallback) {
            console.debug("RemoteDao.deleteEntity", entityId);
            return this._resource.delete({rid: entityId, soft: softDelete}, successCallback);
        },
        /**
         * Find an entity by id. Please note this is an async call.
         * @param entityId
         * @param successCallback
         * @returns {*}
         */
        findEntityById: function (entityId, successCallback) {
            var that = this;
            var result = this._resource.get({rid: entityId}, successCallback);
            bmb.client.setPrototype(result, that._modelPrototype);
            return result;
        },
        /**
         * Update an entity
         * @param entity
         * @param successCallback {function({string})} parameter entity id
         * @param errorCallback {function}
         */
        updateEntity: function (entity, successCallback, errorCallback) {
            return this._resource.update(entity).$promise.then(
                function (data) {
                    successCallback && successCallback(data._id);
                },
                function (err) {
                    errorCallback && errorCallback(err);
                }
            );
        }
    };

    var mod = angular.module(module, ['ngResource', 'bmb.app', 'pascalprecht.translate']);

    /**
     * @ngdoc object
     * @name bmSettingFactory
     * @description
     * A factory to get persistent settings.
     * Usage:
     * var userPref=bmSettingFactory.getSetting("user_pref");
     */
    mod.factory("bmSettingFactory", ["$q", "bmAppData",
        function bmSettingFactory($q, bmAppData) {
            var ydnDb, storeName, keyPath;
            if (!bmAppData.localDataConfig) {
                alert("bmAppData.localDataConfig is not initialized");
            } else {
                ydnDb = bmAppData.localDataConfig.getDb();
                storeName = bmAppData.localDataConfig.getSettingsStore().name;
                keyPath = bmAppData.localDataConfig.getSettingsStore().keyPath;
            }

            /**
             * A <tt>Setting</tt> object represents a specific application setting/configuration.
             * Read/write operations are available.
             * @param key {string} key of setting
             * @param defaultValue {*} default setting value
             * @constructor
             */
            function Setting(key, defaultValue) {
                this.__key = key;
                if (defaultValue) {
                    angular.extend(this, defaultValue);
                }
            }

            /**
             * Load setting from local store asynchronously.
             * @returns {Setting} a promise
             */
            Setting.prototype.loadAsync = function () {
                var self = this;
                var d = $q.defer();
                ydnDb.get(storeName, self.__key)
                    .done(function (dbValue) {
                            angular.extend(self, dbValue);
                            d.resolve(self);
                        }
                    );
                return d.promise;
            };

            /**
             * Persist setting to data store.
             * @return {$q} a promise value of self
             */
            Setting.prototype.save = function () {
                var self = this;
                var deferred = $q.defer();
                var clonedData = JSON.parse(JSON.stringify(self));
                clonedData[keyPath] = self.__key;
                ydnDb.put({name: storeName}, clonedData).done(function () {
                    deferred.resolve(self);
                });
                return deferred.promise;
            };

            /**
             *
             * @param key
             * @param defaultValue
             * @returns {Setting}
             */
            function getSetting(key, defaultValue) {
                return new Setting(key, defaultValue);
            }

            /**
             * Async load a setting
             * @param key
             * @param defaultValue
             * @returns {Setting} a promise
             */
            function loadSetting(key, defaultValue) {
                return new Setting(key, defaultValue);
            }

            return {
                getSetting: getSetting
            };
        }]);

    /**
     * @ngdoc service
     * @name bmUserPref
     * @description Stores user preferences and account information.
     */
    mod.service("bmUserPref", ['bmSettingFactory',
        function bmUserPref(bmSettingFactory) {
            var STORE_NAME = "preference";
            var defaults = {
                language: window.navigator.userLanguage || window.navigator.language,
                theme: "gray",
                background: "light"/*,
                 _$localAccount: null,
                 _$isLoginUser: function () {
                 return !!this._$localAccount;
                 }*/
            };
            return bmSettingFactory.getSetting(STORE_NAME, defaults);
        }]);


    /**
     * @ngdoc provider
     * @name bmAppData
     * @description Provide access to local and remote data
     */
    mod.provider('bmAppData', ['bmAppProvider',
        function bmAppDataProvider(bmAppProvider) {
            var Q;
            var localStores = [], remoteStores = [];
            var options;

            function BmAppData(localDbName) {
                //console.debug("new BmAppData(" + localDbName + ")");
                this.localDataConfig = new bmb.client.LocalDataConfig(localDbName, localStores);
                // this.remoteDataConfig = new bmb.client.RemoteDataConfig(remoteStores, null);
            }

            /**
             *
             * @param storeName {String} Store name
             * @returns {LocalDao}
             */
            BmAppData.prototype.getLocalDao = function (storeName) {
                var localStore = this.localDataConfig.getLocalStore(storeName);
                var ydnDb = this.localDataConfig.getDb();
                return new LocalDao(localStore, ydnDb, Q);
            };

            /**
             *
             * @param storeName
             * @returns {RemoteDao}
             */
            BmAppData.prototype.getRemoteDao = function (storeName, $resource) {
                var remoteStore = this.remoteDataConfig.getRemoteStore(storeName);
                return new RemoteDao(remoteStore.restDataSource.toNgResource($resource), remoteStore.modelPrototype);
            };


            /**
             * Add definition of local store
             * @param localStore {LocalStore}
             */
            this.addLocalStore = function (localStore) {
                localStores.push(localStore);
            };
            /**
             *
             * @param remoteStore {RemoteStore}
             */
            this.addRemoteStore = function (remoteStore) {
                remoteStores.push(remoteStore);
            };

            /**
             *
             * @param opts {{useLocalDb:boolean}}
             */
            this.initOptions = function (opts) {
                options = opts;
            };

            this.$get = ['$q', 'bmApp', function $getBmAppData($q, bmApp) {
                //console.debug("bmAppDataProvider.$get", bmApp.appName);
                var appData = new BmAppData(bmApp.appName);
                angular.extend(appData, options);
                Q = $q;
                return appData;
            }];
        }]);
    /**
     * @ngdoc object
     * @name bmSyncService
     */
    mod.service('bmSyncService', ['bmUserPref', '$http', '$q',
        function bmSyncService(bmUserPref, $http, $q) {
            /**
             *
             * @param localDao {LocalDao} Local DAO
             * @param apiUrl {String} Server API URL for sync like "http://somehost:7001/cts/api/my/sync", HTTP POST for push, HTTP GET for pull
             * @param options {{forceCreationIfNotFound:Boolean}} Sync options
             * @param syncData {{}} A blank object to save data of sync progress and result
             * @return {$q<{
             * status:Number,
             * push:{changes:Number,total:Number,serverCreated:Number,serverUpdated:Number,serverDeleted:Number,serverRejected:Number,clientDeleted:Number},
             * pull:{modified:Number,deleted:Number,localCreated:Number,localUpdated:Number,localDeleted:Number,localDeleted:Number,localRejected:Number,localRejected:Number,localUnprocessed:Number},
             * step:Number}
             * >}
             */
            this.doSync = function (localDao, apiUrl, options, syncData) {
                var d = $q.defer();
                syncData.status = 1;
                syncData.push = {
                    changes: 0,
                    total: 0,
                    serverCreated: 0,
                    serverUpdated: 0,
                    serverDeleted: 0,
                    serverRejected: 0,
                    clientDeleted: 0
                };
                syncData.pull = {
                    modified: 0,
                    deleted: 0,
                    localCreated: 0,
                    localUpdated: 0,
                    localDeleted: 0,
                    localRejected: 0,
                    localUnprocessed: 0
                };
                syncData.step = 1;
                console.debug("Syncing changes from last sync " + bmUserPref.lastSync + "......");
                localDao.findLocalChanges(bmUserPref.lastSync).then(function (lc) {
                    console.debug("1.localChanges", lc);
                    syncData.step = 2;
                    syncData.push.changes = lc.changes.length;
                    $http.post(apiUrl, {
                        changes: lc.changes,
                        options: options
                    }).success(function (lcps) {
                        syncData.step = 3;
                        console.debug("2.localChangesProcessedByServer:", lcps);
                        syncData.push.serverCreated = lcps.created.length;
                        syncData.push.serverDeleted = lcps.deleted.length;
                        syncData.push.serverUpdated = lcps.updated.length;
                        syncData.push.serverRejected = lcps.rejected.length;
                        //Delete obsolete local records
                        var toDeleteIds = [];
                        lcps.rejected.forEach(function (item) {
                            if (item.code == "ModifiedEntityNotFound" || item.code == "DeletedEntityIsClientOnly") {
                                toDeleteIds.push(item[bmb.sci.EntityFields.ID]);
                            }
                        });
                        localDao.deleteEntity(toDeleteIds, false);
                        syncData.push.clientDeleted = toDeleteIds.length;
                        localDao.markLocalChangesSynced(lcps);

                        // Find server changes
                        $http.get(apiUrl, {params: {lmt: bmUserPref.lastSync}}).success(function (sc) {
                            syncData.step = 4;
                            console.debug("3.serverChanges", sc);
                            syncData.pull.deleted = sc.deleted.length;
                            syncData.pull.modified = sc.modified.length;
                            var changes = [];
                            sc.modified.forEach(function (o) {
                                changes.push(o);
                            });
                            sc.deleted.forEach(function (o) {
                                o[bmb.sci.EntityFields.STATUS] = bmb.sci.EntityStatus.DELETED;
                                changes.push(o);
                            });
                            localDao.saveServerChanges(changes).then(function (scpl) {
                                console.debug("4.serverChangesProcessedByLocal", scpl);
                                syncData.pull.localCreated = scpl.created.length;
                                syncData.pull.localUpdated = scpl.updated.length;
                                syncData.pull.localDeleted = scpl.deleted.length;
                                syncData.pull.localRejected = scpl.rejected.length;
                                syncData.pull.localUnprocessed = scpl.unprocessed.length;
                            });
                            syncData.status = 0;
                            d.resolve(syncData);
                        }).error(function (err) {
                            console.error(err);
                            syncData.status = 0;
                            d.reject(err);
                        })
                    }).error(function (err) {
                        console.error(err);
                        syncData.status = 0;
                        d.reject(err);
                    });
                });
                return d.promise;
            }
        }]);

    mod.run(['bmUserPref', '$translate', function _runUserPref(bmUserPref, $translate) {
        bmUserPref.loadAsync().then(function () {
            $translate.use(bmUserPref.language);
        });
    }]);
    
}("bmb.dao"));