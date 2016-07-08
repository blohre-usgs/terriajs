'use strict';

/*global require*/
var defaultValue = require('terriajs-cesium/Source/Core/defaultValue');
var defined = require('terriajs-cesium/Source/Core/defined');
var destroyObject = require('terriajs-cesium/Source/Core/destroyObject');
var knockout = require('terriajs-cesium/Source/ThirdParty/knockout');
var getElement = require('terriajs-cesium/Source/Widgets/getElement');

var loadView = require('../Core/loadView');
var removeView = require('../Core/removeView');
var isBetaEnvironment = require('../Core/isBetaEnvironment');
var PopupMessageViewModel = require('./PopupMessageViewModel');

var BrandBarViewModel = function(options) {
    this.elements = defaultValue(options.elements, []);
    this.bindElementIds = defaultValue(options.bindElementIds, []);

    var container = getElement(defaultValue(options.container, document.body));

    knockout.track(this, ['elements']);
    this.displayBetaBanner = isBetaEnvironment();

    this._domNodes = loadView(require('../Views/BrandBar.html'), container, this);
    var that = this;
    this.bindElementIds.forEach(function(id) {
        var el = getElement(id);
        if(defined(el)) {
            knockout.applyBindings(that, el);
        }
    });
};

BrandBarViewModel.prototype.destroy = function() {
    removeView(this._domNodes);
    destroyObject(this);
};

BrandBarViewModel.prototype.displayProvisionalWarning = function() {
    PopupMessageViewModel.open('ui', {
        title: 'Provisional Software Disclaimer',
        width: 600,
        message: "Software is provisional and subject to revision until it has been thoroughly reviewed and received \
final approval. Provisional software may be inaccurate or contain errors due to an iterative development \
process. Subsequent review based on automated and human testing may result in significant revisions to the \
software. Users are cautioned to consider carefully the provisional nature of the software before using it \
for decisions that concern personal or public safety or the conduct of business that involves substantial \
monetary or operational consequences. Information concerning the accuracy and appropriate uses of the software \
may be obtained from the USGS."
    });
};

BrandBarViewModel.create = function(options) {
    return new BrandBarViewModel(options);
};

module.exports = BrandBarViewModel;
