'use strict';

/*global require*/
var defaultValue = require('terriajs-cesium/Source/Core/defaultValue');
var loadJson = require('terriajs-cesium/Source/Core/loadJson');
var getElement = require('terriajs-cesium/Source/Widgets/getElement');

var loadView = require('../Core/loadView');

var ScienceBaseInfoViewModel = function(options) {
    this.url = defaultValue(options.url, '');
    this.title = '';
    this.shortDescription = '';
    this.description = '';
    this.publicationDate = '';
    this.links = [];
};

ScienceBaseInfoViewModel.prototype.show = function(container) {
    loadView(require('../Views/ScienceBaseInfoSection.html'), container, this);
};

ScienceBaseInfoViewModel.prototype.toggleDescription = function(data, event) {
    var currentEl = event.currentTarget;
    var otherEl = getElement(currentEl.attributes['data-open'].nodeValue);
    var container = currentEl.parentElement.parentElement;
    container.style.display = 'none';
    otherEl.style.display = 'block';
};

ScienceBaseInfoViewModel.create = function(options) {
    var result = new ScienceBaseInfoViewModel(options);
    loadJson(result.url).then(function(data) {
        getPropertiesFromJson(result, data);
        result.show("sbMetadata");
    });
    return result;
};

module.exports = ScienceBaseInfoViewModel;

function getPropertiesFromJson(sbInfoViewModel, data) {
    var description = data.body;
    var shortDescription = description.length > 125 ? description.substring(0, 125).concat('...') : description;

    sbInfoViewModel.title = data.title;
    sbInfoViewModel.shortDescription = shortDescription;
    sbInfoViewModel.description = description;
    sbInfoViewModel.publicationDate = data.dates[0].dateString;

    for (var i = 0; i < data.webLinks.length; i++) {
        var webLink = data.webLinks[i];
        sbInfoViewModel.links.push({
            title: webLink.title,
            href: webLink.uri
        });
    }
}
