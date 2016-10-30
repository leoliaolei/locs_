"use strict";

/*!
 * Shared interfaces between server and client. Exported as ```bmb.sci```
 */

(function (window) {
    /**
     *
     * @type {{EntityStatus: {SYNCED: number, NEW: number, MODIFIED: number, DELETED: number}, LOCAL_ID_PREFIX: string, EntityFields: {STATUS: string, ID: string, LAST_MODIFIED: string, CLIENT_ID: string}, UserVo: Function, BaseModel: Function, utcTimestamp: Function}}
     */
    var sci = {
        EntityStatus: {
            /**
             * Entity in client has been synchronized with server
             * @type {number}
             * @const
             * @static
             */
            SYNCED: 1,
            /**
             * Entity only exists in client
             * @type {number}
             * @const
             * @static
             */
            NEW: 2,
            /**
             * Entity modified in client
             * @type {number}
             * @const
             * @static
             */
            MODIFIED: 3,
            /**
             * Entity marked as deleted in client
             * @type {number}
             * @const
             * @static
             */
            DELETED: -1
        },

        /**
         * The prefix prepended to a client side only entity
         * @type {string}
         * @const
         * @static
         */
        LOCAL_ID_PREFIX: "",

        EntityFields: {
            /**
             * Field saving the synchronization status between client and server
             * @type {string}
             * @const
             * @static
             */
            STATUS: "__status",
            /**
             * Entity ID field
             * @type {string}
             * @const
             * @static
             */
            ID: "_id",
            /**
             * Field saving the last modified time.
             * @type {string}
             * @const
             * @static
             */
            LAST_MODIFIED: "__lmt",

            CLIENT_ID: "__cid"
        },


        UserVo: function () {
            this.loginId = null;
            this.username = null;
            this.email = null;
            this.slat = null;
        },

        /**
         * Basic entity model
         * @constructor
         */
        BaseModel: function () {
            this._id = undefined;
            this.__status = undefined;
            this.__lmt = undefined;
        },
        /**
         * Return mil seconds in UTC
         * @deprecated use gmtTimestamp
         * @returns {number}
         */
        utcTimestamp: function (date) {
            date = date || new Date();
            //return Math.floor(date.getTime() / 1000);
            return date.getTimezoneOffset() * 60 * 1000 + date.getTime();
        },
        /**
         * Return mil seconds in GMT 0 timezone
         * @returns {number}
         */
        gmtTimestamp: function (date) {
            date = date || new Date();
            return date.getTimezoneOffset() * 60 * 1000 + date.getTime();
        },

        /**
         * Convert time in GMT 0 timezone to local timezone.
         * @param gmtMilSec {Number} Mil seconds in GMT 0 timezone
         * @return {Date} Date in local timezone
         */
        gmtToLocalTime: function (gmtMilSec) {
            var offset = new Date().getTimezoneOffset() * 60 * 1000;
            return new Date(gmtMilSec - offset);
        }
    };

    // For nodejs
    if (typeof module !== "undefined") {
        module.exports = sci;
    } else {
        window.bmb = window.bmb || {};
        window.bmb.sci = sci;
    }
})(this);


