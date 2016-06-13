/*!
 * Application basic and common features.
 */
(function bmc_app(module) {
    'use strict';

    var mod = angular.module(module, ['pascalprecht.translate', 'bmb.dao']);

    /**
     * @ngdoc service
     * @name bmDataOps
     * @description
     * Application data maintenance operations of backup, restore, update.
     * Export client side stored data to SD card.
     * Backup according to `bmApp.dataStore` to `bmApp.dataDir`
     *
     * bmDataOps.upgradeData
     * -------------------
     *
     * Application upgrade may change the data schema and content stored on client side.
     * It will
     * - detect current data version and client side stored version
     * - if client side version is old, upgrade existing data. The update is done by injected function
     *   `bmAppUpdaterFn(oldDataVersion)` which shall be overridden in application code to desires.
     * - update client side version number
     * It will do nothing if no `bmAppUpdaterFn` defined or no new version detected.
     *
     */
    mod.service('bmDataOps', ['bmApp','bmAppData', 'bmAppUpdaterFn', 'bmAppDataRestoreFn', '$log', 'bmSettingFactory',
        function bmDataOps(bmApp,bmAppData, bmAppUpdaterFn, bmAppDataRestoreFn, $log, bmSettingFactory) {
            var dataVersion = bmApp.dataVersion;
            var dataDir = bmApp.appName;
            var self = this;
            /**
             * @type {Setting}
             */
            var versionSetting = bmSettingFactory.getSetting("version", {data: 0});

            /**
             * http://docs.phonegap.com/en/2.9.0/cordova_file_file.md.html#FileError
             * https://developer.mozilla.org/en-US/docs/Web/API/FileError
             * @param error
             */
            function onFileError(error) {
                var ERROR_CODES = ["NOT_FOUND_ERR", "SECURITY_ERR", "ABORT_ERR", "NOT_READABLE_ERR", "ENCODING_ERR", "NO_MODIFICATION_ALLOWED_ERR", "INVALID_STATE_ERR", "SYNTAX_ERR", "INVALID_MODIFICATION_ERR", "QUOTA_EXCEEDED_ERR", "TYPE_MISMATCH_ERR", "PATH_EXISTS_ERR"];
                var msg = 'Unknown Error';
                for (var i = 0; i < ERROR_CODES.length; i++) {
                    var code = ERROR_CODES[i];
                    if (FileError[code] == error.code) {
                        msg = code;
                        break;
                    }
                }
                $log.error(msg, error);
            }

            /**
             * @description Backup application data to file.
             * @param exportFilename {string} backup filename
             * @param onSuccess {function(string)} parameter of absolute file path
             */
            this.backupData = function (exportFilename, onSuccess) {
//            $log.alertOn = true;
                var storesData = {};
                var finalData = {version: dataVersion, stores: storesData};
                var stores = bmAppData.localDataConfig.allLocalStores();
                var ydnDb = bmAppData.localDataConfig.getDb();
                var tasks = [
                    function (callback) {
                        callback(null, finalData, 0);
                    }
                ];
                /**
                 *
                 * @param syncResult result after synchronous call
                 * @param currentIndex index of current task in the queue
                 * @param callback
                 */
                var readOneStore = function (syncResult, currentIndex, callback) {
                    var store = stores[currentIndex];
                    var storeName = store.name;
                    finalData.stores[storeName] = [];
                    var it = new ydn.db.ValueIterator(storeName);
                    ydnDb.open(function (cursor) {
                        finalData.stores[storeName].push(cursor.getValue());
                    }, it, "readonly").then(function () {
                        // callback(err, result1, result2, ...)
                        callback(null, finalData.stores, currentIndex + 1);
                    });
                };
                stores.forEach(function (store) {
                    tasks.push(readOneStore);
                });

                //TODO: aync not found!! PROBLEM!!!
                async.waterfall(tasks, function (err, result) {
                    if (err) {
                        $log.error(err);
                    } else {
                        try {
                            $log.debug("finalData", finalData);
                            saveDataToFile(finalData, dataDir, exportFilename, onSuccess);
                        } catch (err) {
                            $log.error(err.message);
                        }
                    }
                });

                function saveDataToFile(data, dir, filename, successCallback) {
                    var text = JSON.stringify(data);
//                    $log.debug("saveDataToFile:" + filename + "," + content);
                    var absFilePath;
                    if (typeof LocalFileSystem == "undefined") {
                        window.prompt("Copy to clipboard: Ctrl+C, Enter", text);
                        return;
                    }
                    window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFileSystem, onFileError);
                    function gotFileSystem(fileSystem) {
                        var rootDir = fileSystem.root;
                        $log.debug("gotFileSystem");
                        rootDir.getDirectory(dir, {create: true, exclusive: false}, function (dirEntry) {
                            $log.debug("gotDirectory");
                            dirEntry.getFile(filename, {create: true, exclusive: false}, gotFileEntry, onFileError);
                        }, onFileError);
                    }

                    function gotFileEntry(fileEntry) {
                        $log.debug("gotFileEntry");
                        absFilePath = fileEntry.fullPath;
                        fileEntry.createWriter(gotFileWriter, onFileError);
                    }

                    function gotFileWriter(fileWriter) {
                        $log.debug("gotFileWriter");
                        fileWriter.onwriteend = function (evt) {
                            successCallback(absFilePath);
                        };
                        fileWriter.write(text);
                    }
                }
            };
            /**
             * Get backup files
             * @param filelist to save file list
             */
            this.findAllBackups = function (filelist) {
                function gotFileSystem(fileSystem) {
                    fileSystem.root.getDirectory(dataDir, {
                        create: true,
                        exclusive: false
                    }, gotFileEntry, onFileError);
                }

                function gotFileEntry(fileEntry) {
                    var dirReader = fileEntry.createReader();
                    var entry;
                    dirReader.readEntries(function (entries) {
                        for (var i = 0, j = entries.length; i < j; i++) {
                            entry = entries[i];
                            if (entry.name.endsWith(".json")) {
                                entry.file(function (file) {
                                    filelist.push({
                                        name: file.name,
                                        fullPath: file.fullPath,
                                        lastModifiedDate: file.lastModifiedDate,
                                        size: file.size
                                    });
                                });
                            }
                        }
                    });
                }

                try {
                    window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFileSystem, onFileError);
                } catch (err) {
                    $log.error("findAllBackups", err.message);
                }
            };
            this.deleteBackup = function (filenames, onSuccess) {
                var count = 0;
                try {
                    window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFileSystem, onFileError);
                } catch (err) {
                    $log.error("deleteBackup", err.message);
                }

                function gotFileSystem(fileSystem) {
                    $log.debug(fileSystem, "fileSystem");
                    for (var j = filenames.length; count < j; count++) {
                        fileSystem.root.getFile(dataDir + "/" + filenames[count], {create: true}, gotFileEntry, onFileError);
                    }
                }

                function gotFileEntry(fileEntry) {
                    $log.debug(fileEntry, "fileEntry");
                    fileEntry.remove(function () {
                        $log.debug("count=" + count + ";filenames.length=" + filenames.length);
                        if (count >= filenames.length - 1)
                            onSuccess();
                    });
                }
            };

            /**
             * Restore data from external file
             * @param filename {string}
             * @param successCallback {function}
             */
            this.restoreData = function (filename, successCallback) {
                if (!bmAppDataRestoreFn) {
                    return;
                }

                function gotFileSystem(fileSystem) {
                    fileSystem.root.getFile(dataDir + "/" + filename, null, gotFileEntry, onFileError);
                }

                function gotFileEntry(fileEntry) {
                    fileEntry.file(gotFile, onFileError);
                }

                function gotFile(file) {
                    var reader = new FileReader();
                    reader.onloadend = function (evt) {
                        var dataText = evt.target.result;
                        bmAppDataRestoreFn(dataText, successCallback);
                    };
                    reader.readAsText(file);
                }

                try {
                    window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFileSystem, onFileError);
                } catch (err) {
                    $log.error(err.message);
                }
            };

            /**
             * Upgrade application data. This function is called when application newly installed
             * or data restored from old version.
             * @param version {number} existing data version. If not specified, function
             * will lookup version from data stored in `bmApp.def.dataStore.version.tableName`
             * @param needBackup {boolean} true to save a backup of existing data
             */
            this.upgradeData = function (version, needBackup) {
                if (!bmAppUpdaterFn) {
                    return;
                }
                var newVersion = bmApp.dataVersion;

                function upgradeFrom(oldVersion) {
                    if (newVersion > oldVersion) {
                        $log.info("Upgrade data from version " + oldVersion + " to " + newVersion);
                        if (needBackup) {
                            document.addEventListener("deviceready", function () {
                                var filename = "update" + "_" + moment().format("YYYYMMDDHHmmss") + ".json";
                                try {
                                    self.backupData(filename, function (filePath) {
                                        $log.info("Backup to " + filePath);
                                    });
                                } catch (err) {
                                    $log.error(err);
                                }
                            });
                        }
                        bmAppUpdaterFn(oldVersion);
                        versionSetting.data = newVersion;
                        versionSetting.save();
                        $log.info("Data upgraded");
                    }
                }

                if (typeof version != "number") {
                    versionSetting.loadAsync().then(function (ver) {
                        upgradeFrom(ver.data);
                    });
                } else {
                    upgradeFrom(version);
                }
            };
        }

    ]);
    
    mod.run(['bmDataOps', function _runUpgradeData(bmDataOps) {
        bmDataOps.upgradeData(null, true);
    }]);

    //---------------------------------------------------------------------
    // Application specific injection
    //---------------------------------------------------------------------
    /**
     * @ngdoc object
     * @name bmAppUpdaterFn
     * @param {string} old version
     * @description a function need override by your application to upgrade application persistent data.
     */
    mod.factory('bmAppUpdaterFn',
        function bmAppUpdaterFn() {
            return angular.noop;
        });
    /**
     * @ngdoc object
     * @name bmAppDataRestoreFn
     * @description a function need override by your application to restore data.
     */
    mod.factory('bmAppDataRestoreFn',
        function bmAppDataRestoreFn() {
            return angular.noop;
        });
})("bmb.app-ops");