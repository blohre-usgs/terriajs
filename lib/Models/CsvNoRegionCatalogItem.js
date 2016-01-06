'use strict';

/*global require*/
var L = require('leaflet');

var clone = require('terriajs-cesium/Source/Core/clone');
var defined = require('terriajs-cesium/Source/Core/defined');
var defineProperties = require('terriajs-cesium/Source/Core/defineProperties');
var DeveloperError = require('terriajs-cesium/Source/Core/DeveloperError');
var freezeObject = require('terriajs-cesium/Source/Core/freezeObject');
var knockout = require('terriajs-cesium/Source/ThirdParty/knockout');
var loadText = require('terriajs-cesium/Source/Core/loadText');
var when = require('terriajs-cesium/Source/ThirdParty/when');

var CatalogItem = require('./CatalogItem');
var inherit = require('../Core/inherit');
var Metadata = require('./Metadata');
var ModelError = require('./ModelError');
var overrideProperty = require('../Core/overrideProperty');
var proxyCatalogItemUrl = require('./proxyCatalogItemUrl');
var readText = require('../Core/readText');
var TableDataSource2 = require('../Map/TableDataSource2');
var TableStyle = require('../Map/TableStyle');
var VarType = require('../Map/VarType');

// Used for region mapping
var ImageryLayerCatalogItem = require('./ImageryLayerCatalogItem');
var ImageryProviderHooks = require('../Map/ImageryProviderHooks');
var WebMapServiceImageryProvider = require('terriajs-cesium/Source/Scene/WebMapServiceImageryProvider');
var WebMapServiceCatalogItem = require('./WebMapServiceCatalogItem');
var WebMercatorTilingScheme = require('terriajs-cesium/Source/Core/WebMercatorTilingScheme');

/**
 * A {@link CatalogItem} representing CSV data.
 *
 * @alias CsvCatalogItem
 * @constructor
 * @extends CatalogItem
 *
 * @param {Terria} terria The Terria instance.
 * @param {String} [url] The URL from which to retrieve the CSV data.
 */
var CsvCatalogItem = function(terria, url) {
    CatalogItem.call(this, terria);

    this._dataSource = undefined;
    this._tableStyle = undefined;  // TODO: not implemented yet
    this._clockTickUnsubscribe = undefined;
    this.url = url;

    /**
     * Gets or sets the CSV data, represented as a binary Blob, a string, or a Promise for one of those things.
     * If this property is set, {@link CatalogItem#url} is ignored.
     * This property is observable.
     * @type {Blob|String|Promise}
     */
    this.data = undefined;

    /**
     * Gets or sets the URL from which the {@link CsvCatalogItem#data} was obtained.  This is informational; it is not
     * used.  This propery is observable.
     * @type {String}
     */
    this.dataSourceUrl = undefined;

    /**
     * Gets or sets the opacity (alpha) of the data item, where 0.0 is fully transparent and 1.0 is
     * fully opaque.  This property is observable.
     * @type {Number}
     * @default 0.6
     */
    this.opacity = 0.6;

    /**
     * Keeps the layer on top of all other imagery layers.  This property is observable.
     * @type {Boolean}
     * @default false
     */
    this.keepOnTop = false;

    /**
     * Should any warnings like failures in region mapping be displayed to the user?
     * @type {Boolean}
     * @default true
     */
    this.showWarnings = true;

    /**
     * Disable the ability to change the display of the dataset via displayVariablesConcept.
     * This property is observable.
     * @type {Boolean}
     * @default false
     */
    this.disableUserChanges = false;

    this._tableStyle = undefined;

    // Region mapping imagery layer.
    this._imageryLayer = undefined;

    // The region mapping imagery provider.
    this._regionImageryProvider = undefined;

    knockout.track(this, ['data', 'dataSourceUrl', 'opacity', 'keepOnTop', 'disableUserChanges', 'showWarnings', '_dataSource']);

    // var that = this;
    knockout.defineProperty(this, 'concepts', {
        get: function() {
            if (defined(this._dataSource) && defined(this._dataSource.tableStructure)) {
                return [this._dataSource.tableStructure];
            } else {
                return [];
            }
        }
    });

    /**
     * Gets or sets the tableStyle object
     * This needs to be a property on the object (not the prototype), so that updateFromJson sees it.
     * @type {Object}
     */
    knockout.defineProperty(this, 'tableStyle', {
        get : function() {
            return this._tableStyle;
        }
    });

    overrideProperty(this, 'clock', {
        get: function() {
            return this._dataSource.clock;
        }
    });

    overrideProperty(this, 'legendUrl', {
        get: function() {
            // Whenever the legend changes, we need to repaint the features.
            // This doesn't catch every case, eg. if you move from one legendless selected variable to another.
            // Is there a more direct way to trigger this?
            this.terria.currentViewer.notifyRepaintRequired();
            // And update the legendUrl
            if (defined(this._dataSource)) {
                return this._dataSource.legendUrl;
            }
        }
    });

    overrideProperty(this, 'rectangle', {
        get: function() {
            if (defined(this._dataSource) && defined(this._dataSource)) {
                return this._dataSource.extent;
            }
        }
    });
};

inherit(CatalogItem, CsvCatalogItem);


defineProperties(CsvCatalogItem.prototype, {
    /**
     * Gets the type of data member represented by this instance.
     * @memberOf CsvCatalogItem.prototype
     * @type {String}
     */
    type: {
        get: function() {
            return 'csv';
        }
    },

    /**
     * Gets a human-readable name for this type of data source, 'CSV'.
     * @memberOf CsvCatalogItem.prototype
     * @type {String}
     */
    typeName: {
        get: function() {
            return 'Comma-Separated Values (CSV)';
        }
    },

    /**
     * Gets the metadata associated with this data source and the server that provided it, if applicable.
     * @memberOf CsvCatalogItem.prototype
     * @type {Metadata}
     */
    metadata: { //TODO: return metadata if tableDataSource defined
        get: function() {
            var result = new Metadata();
            result.isLoading = false;
            result.dataSourceErrorMessage = 'This data source does not have any details available.';
            result.serviceErrorMessage = 'This service does not have any details available.';
            return result;
        }
    },

    /**
     * Gets a value indicating whether this data source, when enabled, can be reordered with respect to other data sources.
     * Data sources that cannot be reordered are typically displayed above reorderable data sources.
     * @memberOf CsvCatalogItem.prototype
     * @type {Boolean}
     */
    supportsReordering: {
        get: function() {
            return defined(this._dataSource) && this._dataSource.region && !this.keepOnTop;
        }
    },

    /**
     * Gets a value indicating whether the opacity of this data source can be changed.
     * @memberOf ImageryLayerCatalogItem.prototype
     * @type {Boolean}
     */
    supportsOpacity: {
        get: function() {
            return (defined(this._dataSource) && this._dataSource.region);
        }
    },

    /**
     * Gets the data source associated with this catalog item.
     * @memberOf CsvCatalogItem.prototype
     * @type {DataSource}
     */
    dataSource: {
        get: function() {
            return this._dataSource;
        }
    },

    /**
     * Gets the Cesium or Leaflet imagery layer object associated with this data source.
     * Used in region mapping only.
     * This property is undefined if the data source is not enabled.
     * @memberOf CsvCatalogItem.prototype
     * @type {Object}
     */
    imageryLayer : {
        get : function() {
            return this._imageryLayer;
        }
    },

    /**
     * Gets the set of names of the properties to be serialized for this object when {@link CatalogMember#serializeToJson} is called
     * and the `serializeForSharing` flag is set in the options.
     * @memberOf ImageryLayerCatalogItem.prototype
     * @type {String[]}
     */
    propertiesForSharing : {
        get : function() {
            return CsvCatalogItem.defaultPropertiesForSharing;
        }
    },

    /**
     * Gets the set of functions used to update individual properties in {@link CatalogMember#updateFromJson}.
     * When a property name in the returned object literal matches the name of a property on this instance, the value
     * will be called as a function and passed a reference to this instance, a reference to the source JSON object
     * literal, and the name of the property.
     * @memberOf CsvCatalogItem.prototype
     * @type {Object}
     */
    updaters : {
        get : function() {
            return CsvCatalogItem.defaultUpdaters;
        }
    },

    /**
     * Gets the set of functions used to serialize individual properties in {@link CatalogMember#serializeToJson}.
     * When a property name on the model matches the name of a property in the serializers object lieral,
     * the value will be called as a function and passed a reference to the model, a reference to the destination
     * JSON object literal, and the name of the property.
     * @memberOf CsvCatalogItem.prototype
     * @type {Object}
     */
    serializers : {
        get : function() {
            return CsvCatalogItem.defaultSerializers;
        }
    }
});

CsvCatalogItem.defaultUpdaters = clone(CatalogItem.defaultUpdaters);

CsvCatalogItem.defaultUpdaters.tableStyle = function(csvItem, json, propertyName, options) {
    csvItem._tableStyle = new TableStyle();
    return csvItem._tableStyle.updateFromJson(json[propertyName], options);
};

freezeObject(CsvCatalogItem.defaultUpdaters);

CsvCatalogItem.defaultSerializers = clone(CatalogItem.defaultSerializers);

// TODO: is this right?
CsvCatalogItem.defaultSerializers.tableStyle = function(csvItem, json, propertyName, options) {
    json[propertyName] = csvItem[propertyName].serializeToJson(options);
};

// TODO: is this necessary?
CsvCatalogItem.defaultSerializers.legendUrl = function() {
    // Don't serialize, because legends are generated, and sticking an image embedded in a URL is a terrible idea.
};

freezeObject(CsvCatalogItem.defaultSerializers);

/**
 * Gets or sets the default set of properties that are serialized when serializing a {@link CatalogItem}-derived object with the
 * `serializeForSharing` flag set in the options.
 * @type {String[]}
 */
CsvCatalogItem.defaultPropertiesForSharing = clone(CatalogItem.defaultPropertiesForSharing);
CsvCatalogItem.defaultPropertiesForSharing.push('keepOnTop');
CsvCatalogItem.defaultPropertiesForSharing.push('disableUserChanges');
CsvCatalogItem.defaultPropertiesForSharing.push('opacity');
CsvCatalogItem.defaultPropertiesForSharing.push('tableStyle');
freezeObject(CsvCatalogItem.defaultPropertiesForSharing);


CsvCatalogItem.prototype._getValuesThatInfluenceLoad = function() {
    return [this.url, this.data];
};


function loadTable(csvItem, text) {
    var dataSource = csvItem._dataSource;
    dataSource.load(text, csvItem._tableStyle);
    if (dataSource.hasLatitudeAndLongitude) {
        // Choose a reasonable column as the default selected column. Choose the first SCALAR or ENUM column.
        var columnsByType = dataSource._tableStructure.columnsByType;
        var column = columnsByType[VarType.SCALAR][0] || columnsByType[VarType.ENUM][0];
        if (column) {
            column.toggleActive();
        }
    }
}


CsvCatalogItem.prototype._load = function() {
    if (defined(this._dataSource)) {
        this._dataSource.destroy();
    }

    this._dataSource = new TableDataSource2(this._terria);

    var that = this;

    if (defined(this.data)) {
        return when(that.data, function(data) {
            if (typeof Blob !== 'undefined' && data instanceof Blob) {
                return readText(data).then(function(text) {
                    return loadTable(that, text);
                });
            } else if (typeof data === 'string') {
                return loadTable(that, data);
            } else {
                throw new ModelError({
                    sender: that,
                    title: 'Unexpected type of CSV data',
                    message: 'CsvCatalogItem data is expected to be a Blob, File, or String, but it was not any of these. ' +
                        'This may indicate a bug in terriajs or incorrect use of the terriajs API. ' +
                        'If you believe it is a bug in ' + that.terria.appName + ', please report it by emailing ' +
                        '<a href="mailto:' + that.terria.supportEmail + '">' + that.terria.supportEmail + '</a>.'
                });
            }
        });
    } else if (defined(that.url)) {
        return loadText(proxyCatalogItemUrl(that, that.url)).then(function(text) {
            return loadTable(that, text);
        }).otherwise(function(e) {
            throw new ModelError({
                sender: that,
                title: 'Unable to load CSV file',
                message: 'See the <a href="https://github.com/NICTA/nationalmap/wiki/csv-geo-au">csv-geo-au</a> specification for supported CSV formats.\n\n' + (e.message || e.response)
            });
        });
    }
};

CsvCatalogItem.prototype._enable = function(layerIndex) {
    var that = this;
    this._dataSource.regionPromise.then(function(region) {
        if (region) {
            that._imageryLayer = ImageryLayerCatalogItem.enableLayer(that, createRegionImageryProvider(that), that.opacity, layerIndex);
            // Would like to move this leaflet-specific behavior somewhere better
            if (defined(that.terria.leaflet)) {
                that._imageryLayer.setFilter(function () {
                    new L.CanvasFilter(that, {
                        channelFilter: function (image) {
                            return ImageryProviderHooks.recolorImage(image, function(id) { return [0, 200, 100, 255]; });
                        }
                    }).render();
                });
            }
        }
    });
};

CsvCatalogItem.prototype._disable = function() {
    var that = this;
    this._dataSource.regionPromise.then(function(region) {
        if (region) {
            ImageryLayerCatalogItem.disableLayer(that, that._imageryLayer);
            that._imageryLayer = undefined;
        }
    });
};

CsvCatalogItem.prototype._show = function() {
    var that = this;
    this._dataSource.regionPromise.then(function(region) {
        if (region) {
            ImageryLayerCatalogItem.showLayer(that, that._imageryLayer);
        } else {
            var dataSources = that.terria.dataSources;
            if (dataSources.contains(that._dataSource)) {
                throw new DeveloperError('This data source is already shown.');
            }
            dataSources.add(that._dataSource);
        }
    });
};

CsvCatalogItem.prototype._hide = function() {
    var that = this;
    this._dataSource.regionPromise.then(function(region) {
        if (region) {
            ImageryLayerCatalogItem.hideLayer(that, that._imageryLayer);
        } else {
            var dataSources = that.terria.dataSources;
            if (!dataSources.contains(that._dataSource)) {
                throw new DeveloperError('This data source is not shown.');
            }
            dataSources.remove(that._dataSource, false);
        }
    });
};

// Also stores the created imageryProvider in catalogItem._regionImageryProvider.
function createRegionImageryProvider(catalogItem) {
    var region = catalogItem._dataSource.region;
    catalogItem._regionImageryProvider = new WebMapServiceImageryProvider({
        url: proxyCatalogItemUrl(catalogItem, region.regionProvider.server),
        layers: region.regionProvider.layerName,
        parameters: WebMapServiceCatalogItem.defaultParameters,
        getFeatureInfoParameters: WebMapServiceCatalogItem.defaultParameters,
        tilingScheme: new WebMercatorTilingScheme()
    });
    var tableStructure = catalogItem._dataSource.tableStructure;
    var legendHelper = catalogItem._dataSource._legendHelper;
    // if (defined(tableStructure.activeItems[0])) {
    //     // only recolor the regions if there is a variable to base the recoloring on
    //     var regionValues = catalogItem._dataSource.region.regionProvider.getRegionValues(tableStructure.activeItems[0].values, region.column.values, region.disambigColumn.values);
    //     var colorFunction = catalogItem._dataSource.region.regionProvider.getColorLookupFunc(regionValues, legendHelper.getColorFromValue.bind(legendHelper));
    //     ImageryProviderHooks.addRecolorFunc(catalogItem._regionImageryProvider, colorFunction);
    // }
    // ImageryProviderHooks.addPickFeaturesHook(catalogItem._regionImageryProvider, function(results) {
    //     if (!defined(results) || results.length === 0) {
    //         return;
    //     }

    //     for (var i = 0; i < results.length; ++i) {
    //         // var uniqueId = results[i].data.properties[catalogItem._dataSource.region.regionProvider.uniqueIdProp];
    //         // var properties = catalogItem.rowProperties(uniqueId);
    //         // results[i].description = catalogItem._tableDataSource.describe(properties);
    //     }

    //     return results;
    // });
    return catalogItem._regionImageryProvider;
}

module.exports = CsvCatalogItem;