'use strict';

/**
 * Determines if the current url looks like a beta url.
 *
 * @return {Boolean} true if this environment seems to be beta.
 */
var isBetaEnvironment = function() {
    var url = window.location.toString();
    return urlContainsAnyString([
        'beta',
        // 'localhost',
        'staging'
    ]);

    function isPresentInUrl(str) {
        return url.indexOf(str) >= 0;
    }

    function urlContainsAnyString(stringArray) {
        return stringArray.find(isPresentInUrl) !== undefined;
    }
};

module.exports = isBetaEnvironment;
