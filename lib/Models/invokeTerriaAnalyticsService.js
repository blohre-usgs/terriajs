'use strict';

/*global require*/
var AsyncFunctionResultCatalogItem = require('./AsyncFunctionResultCatalogItem');
var defined = require('terriajs-cesium/Source/Core/defined');
var JulianDate = require('terriajs-cesium/Source/Core/JulianDate');
var loadWithXhr = require('terriajs-cesium/Source/Core/loadWithXhr');
var loadJson = require('terriajs-cesium/Source/Core/loadJson');
var TerriaError = require('../Core/TerriaError');
var runLater = require('../Core/runLater');

var invokeTerriaAnalyticsService = function(terria, name, url, request) {
    // Create a catalog item to track the progress of this service invocation.
    var asyncResult = new AsyncFunctionResultCatalogItem(terria);
    asyncResult.name = name;

    var startDate = JulianDate.now();

    // Invoke the service
    var promise = loadWithXhr({
        url: url,
        method: 'POST',
        data: JSON.stringify(request)
    }).then(function(response) {
        var json = JSON.parse(response);

        // Poll until the invocation is complete.
        return pollForCompletion(json, asyncResult, startDate);
    });

    asyncResult.loadPromise = promise;
    asyncResult.isEnabled = true;

    return promise;
};

var pollInterval = 1000;

function pollForCompletion(invocation, invocationCatalogItem, startDate) {
    return loadJson(invocation.status_uri).then(function(statusResult) {
        if (statusResult.queueing_status !== 'finished') {
            if (defined(statusResult.stage_description)) {
                invocationCatalogItem.loadingMessage = statusResult.stage_description;
            }

            if (statusResult.queueing_status === 'failed') {
                throw new TerriaError({
                    title: 'Service invocation failed',
                    message: 'An error occurred on the server while computing "' + invocationCatalogItem.name + '".'
                });
            }

            // Try again later, if this catalog item is still enabled.
            if (invocationCatalogItem.isEnabled) {
                return runLater(pollForCompletion.bind(undefined, invocation, invocationCatalogItem, startDate), pollInterval);
            }
        }

        // Finished!
        return loadJson(invocation.uri).then(function(jobResult) {
            // Remove the temporary catalog item showing invocation progress.
            invocationCatalogItem.isEnabled = false;
            return {
                startDate: startDate,
                finishDate: JulianDate.now(),
                url: invocation.uri,
                result: jobResult
            };
        });
    });
}

module.exports = invokeTerriaAnalyticsService;
