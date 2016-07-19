'use strict';

/*global require*/
var URI = require('urijs');
var createPdf = require('pdfmake-browserified');

var CesiumMath = require('terriajs-cesium/Source/Core/Math');
var defined = require('terriajs-cesium/Source/Core/defined');
var knockout = require('terriajs-cesium/Source/ThirdParty/knockout');
var defaultValue = require('terriajs-cesium/Source/Core/defaultValue');
var Ellipsoid = require('terriajs-cesium/Source/Core/Ellipsoid');

var inherit = require('../Core/inherit');
var combineFilters = require('../Core/combineFilters');
var TerriaError = require('../Core/TerriaError');
var CatalogMember = require('../Models/CatalogMember');
var PopupViewModel = require('./PopupViewModel');
var hashEntity = require('../Core/hashEntity');

/**
 * A dialog that displays a url to the user reflecting the map's current state, and also displays HTML for embedding
 * it as an iframe into another site.
 *
 * @param options {Object}
 * @param options.terria {Terria} the terria instance to get data from
 * @param options.userPropWhiteList {Object} A white list of userProperty ids that will be reflected in the share link.
 *          Defaults to SharePopupViewModel#defaultUserPropWhiteList. Override this if you have custom userProperties
 *          that you want to be shared along with the rest of the map.
 */
var SharePopupViewModel = function(options) {
    PopupViewModel.call(this, options);
    this.terria = options.terria;
    this.userPropWhiteList = defaultValue(options.userPropWhiteList, SharePopupViewModel.defaultUserPropWhiteList);

    this._longUrl = undefined;
    this._shortUrl = undefined;

    this.title = "Share";
    this.url = '';
    this.imageUrl = '';
    this.embedCode = '';
    this.itemsSkippedBecauseTheyHaveLocalData = [];
    this.enableShortenUrl = defined(this.terria.urlShortener) && this.terria.urlShortener.isUsable;

    var shortenLocalProperty = this.terria.getLocalProperty('shortenShareUrls');
    this.shortenUrl = this.enableShortenUrl && (!defined(shortenLocalProperty) || shortenLocalProperty);

    this.view = require('../Views/SharePopup.html');

    knockout.track(this, ['imageUrl', 'url', 'embedCode', 'shortenUrl', 'enableShortenUrl', 'itemsSkippedBecauseTheyHaveLocalData']);

    var that = this;

    knockout.getObservable(this, 'shortenUrl').subscribe(function() {
        that.terria.setLocalProperty('shortenShareUrls', that.shortenUrl);
        setShareUrl(that);
    });

    // Build the share URL.
    var request = {
        version: '0.0.05',
        initSources: this.terria.initSources.slice()
    };

    var initSources = request.initSources;

    this._addUserAddedCatalog(initSources);
    this._addSharedMembers(initSources);
    this._addViewSettings(initSources);
    this._addFeaturePicking(initSources);

    var uri = new URI(window.location);

    // Remove the portion of the URL after the hash.
    uri.fragment('');

    var requestString = JSON.stringify(request);

    this._baseUrl = uri.toString() + '#start=';
    this._shortBaseUrl = uri.toString() + '#share=';

    this._longUrl = this._baseUrl + encodeURIComponent(requestString) + this._generateUserPropertiesQuery();

    setShareUrl(this);

    var pdfConfig = this.terria.configParameters.pdfConfig;
    this._pdfInfo = {
        title: pdfConfig ? pdfConfig.title : undefined,
        url: uri.toString(),
        currentItems: this.terria.nowViewing.items,
        logo: pdfConfig ? pdfConfig.pdfLogoDataUri : undefined
    };

    this.terria.currentViewer.captureScreenshot().then(function(dataUrl) {
        that.imageUrl = dataUrl;
    });
};

inherit(PopupViewModel, SharePopupViewModel);

SharePopupViewModel.prototype.downloadPdf = function() {
    // var items = this.terria.nowViewing.items;
    var docDefinition = {
        pageOrientation: 'landscape',
        pageMargins: [20, 10],
        background: {
            image: this.imageUrl,
            width: 700,
            margin: [100, 65, 0, 0]
        },
        content: getPdfContent(this._pdfInfo, this.imageUrl)
    };
    createPdf(docDefinition).download(this.terria.appName + '.pdf');
};

/**
 * Adds user-added catalog members to the passed initSources.
 * @private
 */
SharePopupViewModel.prototype._addUserAddedCatalog = function(initSources) {
    var localDataFilterRemembering = rememberRejections(CatalogMember.itemFilters.noLocalData);

    var userAddedCatalog = this.terria.catalog.serializeToJson({
        itemFilter: combineFilters([
            localDataFilterRemembering.filter,
            CatalogMember.itemFilters.userSuppliedOnly,
            function(item) {
                // If the parent has a URL then this item will just load from that, so don't bother serializing it.
                // Properties that change when an item is enabled like opacity will be included in the shared members
                // anyway.
                return !item.parent || !item.parent.url;
            }
        ])
    });

    this.itemsSkippedBecauseTheyHaveLocalData = localDataFilterRemembering.rejections;

    // Add an init source with user-added catalog members.
    if (userAddedCatalog.length > 0) {
        initSources.push({
            catalog: userAddedCatalog
        });
    }
};

/**
 * Adds existing catalog members that the user has enabled or opened to the passed initSources object.
 * @private
 */
SharePopupViewModel.prototype._addSharedMembers = function(initSources) {
    var catalogForSharing = flattenCatalog(this.terria.catalog.serializeToJson({
        itemFilter: combineFilters([
            CatalogMember.itemFilters.noLocalData
        ]),
        propertyFilter: combineFilters([
            CatalogMember.propertyFilters.sharedOnly,
            function(property) {
                return property !== 'name';
            }
        ])
    })).filter(function(item) {
        return item.isEnabled || item.isOpen;
    }).reduce(function(soFar, item) {
        soFar[item.id] = item;
        item.id = undefined;
        return soFar;
    }, {});

    // Eliminate open groups without all ancestors open
    Object.keys(catalogForSharing).forEach(function(key) {
        var item = catalogForSharing[key];
        var isGroupWithClosedParent = item.isOpen && item.parents.some(function(parentId) {
            return !catalogForSharing[parentId];
        }.bind(this));

        if (isGroupWithClosedParent) {
            catalogForSharing[key] = undefined;
        }
    }.bind(this));

    if (Object.keys(catalogForSharing).length > 0) {
        initSources.push({
            sharedCatalogMembers: catalogForSharing
        });
    }
};

/**
 * Adds the details of the current view to the init sources.
 * @private
 */
SharePopupViewModel.prototype._addViewSettings = function(initSources) {
    var cameraExtent = this.terria.currentViewer.getCurrentExtent();

    // Add an init source with the camera position.
    var initialCamera = {
        west: CesiumMath.toDegrees(cameraExtent.west),
        south: CesiumMath.toDegrees(cameraExtent.south),
        east: CesiumMath.toDegrees(cameraExtent.east),
        north: CesiumMath.toDegrees(cameraExtent.north)
    };

    if (defined(this.terria.cesium)) {
        var cesiumCamera = this.terria.cesium.scene.camera;
        initialCamera.position = cesiumCamera.positionWC;
        initialCamera.direction = cesiumCamera.directionWC;
        initialCamera.up = cesiumCamera.upWC;
    }

    var homeCamera = {
        west: CesiumMath.toDegrees(this.terria.homeView.rectangle.west),
        south: CesiumMath.toDegrees(this.terria.homeView.rectangle.south),
        east: CesiumMath.toDegrees(this.terria.homeView.rectangle.east),
        north: CesiumMath.toDegrees(this.terria.homeView.rectangle.north),
        position: this.terria.homeView.position,
        direction: this.terria.homeView.direction,
        up: this.terria.homeView.up
    };

    initSources.push({
        initialCamera: initialCamera,
        homeCamera: homeCamera,
        baseMapName: this.terria.baseMap.name,
        viewerMode: this.terria.leaflet ? '2d': '3d'
    });
};

SharePopupViewModel.prototype._addFeaturePicking = function(initSources) {
    if (defined(this.terria.pickedFeatures) && this.terria.pickedFeatures.features.length > 0) {
        var positionInRadians = Ellipsoid.WGS84.cartesianToCartographic(this.terria.pickedFeatures.pickPosition);

        var pickedFeatures = {
            providerCoords: this.terria.pickedFeatures.providerCoords,
            pickCoords: {
                lat: CesiumMath.toDegrees(positionInRadians.latitude),
                lng: CesiumMath.toDegrees(positionInRadians.longitude),
                height: positionInRadians.height
            }
        };

        if (defined(this.terria.selectedFeature)) {
            // Sometimes features have stable ids and sometimes they're randomly generated every time, so include both
            // id and name as a fallback.
            pickedFeatures.current = {
                name: this.terria.selectedFeature.name,
                hash: hashEntity(this.terria.selectedFeature, this.terria.clock)
            };
        }

        // Remember the ids of vector features only, the raster ones we can reconstruct from providerCoords.
        pickedFeatures.entities = this.terria.pickedFeatures.features.filter(function(feature) {
            return !defined(feature.imageryLayer);
        }).map(function(entity) {
            return {
                name: entity.name,
                hash: hashEntity(entity, this.terria.clock)
            };
        }.bind(this));

        initSources.push({
            pickedFeatures: pickedFeatures
        });
    }
};

/**
 * Generates a query string for custom user properties.
 *
 * @returns {String}
 * @private
 */
SharePopupViewModel.prototype._generateUserPropertiesQuery = function() {
    return this.userPropWhiteList.reduce(function(querySoFar, key) {
        var val = this.terria.userProperties[key];
        if (defined(val)) {
            return querySoFar + '&' + key + '=' + encodeURIComponent(val);
        }
        return querySoFar;
    }.bind(this), '');
};

function setShareUrl(viewModel) {
    var iframeString = '<iframe style="width: 720px; height: 405px; border: none;" src="_TARGET_" allowFullScreen mozAllowFullScreen webkitAllowFullScreen></iframe>';

    function setUrlAndEmbed(url) {
        viewModel.url = url;
        viewModel.embedCode = iframeString.replace('_TARGET_', viewModel.url);
    }

    if (!viewModel.shortenUrl) {
        setUrlAndEmbed(viewModel._longUrl);
    }
    else if (defined(viewModel._shortUrl)) {
        setUrlAndEmbed(viewModel._shortUrl);
    }
    else {
        viewModel.terria.urlShortener.shorten(viewModel._longUrl).then(function(token) {
            viewModel._shortUrl = viewModel._shortBaseUrl + token;
            setUrlAndEmbed(viewModel._shortUrl);
            viewModel.terria.analytics.logEvent('share', 'url', viewModel._shortUrl);
        }).otherwise(function() {
            viewModel.terria.error.raiseEvent(new TerriaError({
                title: 'Unable to shorten URL',
                message: 'An error occurred while attempting to shorten the URL.  Please check your internet connection and try again.'
            }));
            viewModel.shortenUrl = false;
            setUrlAndEmbed(viewModel._longUrl);
        });
    }
}

SharePopupViewModel.defaultUserPropWhiteList = ['hideExplorerPanel', 'activeTabId'];

SharePopupViewModel.open = function(options) {
    var viewModel = new SharePopupViewModel(options);
    viewModel.show(options.container);
    return viewModel;
};

/**
 * Wraps around a filter function and records all items that are excluded by it. Does not modify the function passed in.
 *
 * @param filterFn The fn to wrap around
 * @returns {{filter: filter, rejections: Array}} The resulting filter function that remembers rejections, and an array
 *          array of the rejected items. As the filter function is used, the rejections array with be populated.
 */
function rememberRejections(filterFn) {
    var rejections = [];

    return {
        filter: function(item) {
            var allowed = filterFn(item);

            if (!allowed) {
                rejections.push(item);
            }

            return allowed;
        },
        rejections: rejections
    };
}

/**
 * Takes the hierarchy of serialized catalog members returned by {@link serializeToJson} and flattens it into an Array.
 * @returns {Array}
 */
function flattenCatalog(items) {
    return items.reduce(function (soFar, item) {
        soFar.push(item);

        if (item.items) {
            soFar = soFar.concat(flattenCatalog(item.items));
            item.items = undefined;
        }

        return soFar;
    }, []);
}

function getPdfContent(pdfInfo) {
    // var deferred = when.defer();

    var leftColumn = [];
    var rightColumn = [];

    var legends = [];
    if(pdfInfo.currentItems.length > 0) {
        if(pdfInfo.logo) {
            leftColumn.push({
                image: pdfInfo.logo,
                width: 145,
                height: 50,
                margin: [0, 0, 0, 2]
            });
        }
        pdfInfo.currentItems.forEach(function(item) {
            rightColumn.push({
                text: (pdfInfo.title ? pdfInfo.title : item.parent.name) + ': ' + item.name,
                bold: true,
                fontSize: 16,
                margin: [0, 15, 0, 0],
                fillColor: 'green'
            });
            rightColumn.push({
                text: pdfInfo.url,
                italics: true,
                margin: [0, 2],
                fontSize: 10
            });
            if(defined(item.legendUrl)) {
                // getLegendImageFromSvg(item.legendUrl.safeSvgContent, function(data) {
                //     deferred.resolve([
                //         {
                //             table: {
                //                 widths: [145, 'auto'],
                //                 headerRows: 0,
                //                 body:
                //                     [
                //                         [
                //                             {
                //                                 stack: leftColumn
                //                             },
                //                             {
                //                                 stack: rightColumn
                //                             }
                //                         ]
                //                     ]
                //             },
                //             layout: 'noBorders'
                //             // columns: [
                //             //     {
                //             //         //width: 150,
                //             //         stack: leftColumn
                //             //     },
                //             //     {
                //             //         width: 650,
                //             //         stack: rightColumn,
                //             //         margin: [10, 0]
                //             //     }
                //             // ]
                //         },
                //         {
                //             stack: [data]
                //
                //         }
                //     ]);
                // });
                // legends.push(getLegendFromSvgHorizontal(item.legendUrl.safeSvgContent));
                leftColumn.push(getLegendFromSvg(item.legendUrl.safeSvgContent));//getLegendImgFromSvg(item.legendUrl.safeSvgContent));
            }
        });

        return [
            {
                table: {
                    widths: [145, 'auto'],
                    headerRows: 0,
                    body:
                        [
                            [
                                {
                                    stack: leftColumn
                                },
                                {
                                    stack: rightColumn
                                }
                            ]
                        ]
                },
                layout: 'noBorders'
                // columns: [
                //     {
                //         //width: 150,
                //         stack: leftColumn
                //     },
                //     {
                //         width: 650,
                //         stack: rightColumn,
                //         margin: [10, 0]
                //     }
                // ]
            }//,
            // {
            //     stack: legends
            //
            // }
        ];

        // return deferred.promise;
        //[{table: {body: [['thing', 'things2']]}}]
    }

    return [];
}

function getLegendFromSvg(legendSvg) {
    var results = [];
    var parser = new DOMParser();
    var doc = parser.parseFromString(legendSvg, "image/svg+xml");
    var g = doc.getElementsByTagName('g')[0];
    if(g) {
        var children = [].slice.call(g.childNodes);
        var texts = [];
        children.forEach(function(value, index, array) {
            if(value.tagName === 'text') {
                if(index === 0) {
                    texts.push(value.textContent);
                    return;
                }
                var previousValue = array[index - 1];
                //if the previous node was also text then combine the two because they are one label on
                // two separate lines
                if(previousValue.nodeName === value.nodeName) {
                    //remove the previousValue from the texts array
                    var previousString = texts.pop();
                    //add the combined values to the texts array
                    texts.push(previousString + value.textContent);
                    return;
                }
                texts.push(value.textContent);
            }
        });
        var images = g.getElementsByTagName('image');
        var table = {
            table: {
                headerRows: 0,
                widths: [10, 75],
                body: []
            },
            layout: {
                hLineWidth: function(i, node) { return 0; },
                vLineWidth: function(i, node) { return 0; },
                paddingLeft: function(i, node) { return 0; },
                paddingRight: function(i, node) { return 0; },
                paddingTop: function(i, node) { return 0; }
            }
        };
        for(var i = 0; i < images.length; i++) {
            var data = images[i].getAttribute('xlink:href');
            table.table.body.push([
                getColorSwatchElement(data),
                getLabelTextElement(texts[i])
            ]);

            //d results.push({
            //     columns: [
            //         getColorSwatchElement(data),
            //         getLabelTextElement(texts[i])
            //     ],
            //     margin: [10, 0, 0, 0]
            // })
        }
        return table;
    }

    return results;
}

function getLegendImgFromSvg(legendSvg) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    ctx.font = "12px Arial";
    canvas.style.backgroundColor = 'rgb(256, 256, 256)';

    var results = [];
    var parser = new DOMParser();
    var doc = parser.parseFromString(legendSvg, "image/svg+xml");
    var g = doc.getElementsByTagName('g')[0];
    if(g) {
        var finalImage = '';
        var children = [].slice.call(g.childNodes);
        var texts = [];
        children.forEach(function(value, index, array) {
            if(value.tagName === 'text') {
                if(index === 0) {
                    texts.push(value.textContent);
                    return;
                }
                var previousValue = array[index - 1];
                //if the previous node was also text then combine the two because they are one label on
                // two separate lines
                if(previousValue.nodeName === value.nodeName) {
                    //remove the previousValue from the texts array
                    var previousString = texts.pop();
                    //add the combined values to the texts array
                    texts.push(previousString + value.textContent);
                    return;
                }
                texts.push(value.textContent);
            }
        });
        var images = g.getElementsByTagName('image');
        // var table = {
        //     table: {
        //         headerRows: 0,
        //         widths: [10, 130],
        //         body: []
        //     },
        //     layout: {
        //         hLineWidth: function(i, node) { return 0; },
        //         vLineWidth: function(i, node) { return 0; },
        //         paddingLeft: function(i, node) { return 0; },
        //         paddingRight: function(i, node) { return 0; },
        //         paddingTop: function(i, node) { return 0; }
        //     }
        // };
        var yPosition = 0;
        for(var i = 0; i < images.length/2; i++) {
            var image = images[i];
            var data = images[i].getAttribute('xlink:href');
            var img = new Image();
            img.src = data;
            ctx.drawImage(img, 0, yPosition);
            ctx.fillText(texts[i], image.width.baseVal.value + 2, yPosition + (image.height.baseVal.value/1.5));
            yPosition += image.height.baseVal.value;

            // table.table.body.push([
            //     getColorSwatchElement(data),
            //     getLabelTextElement(texts[i])
            // ]);

            //d results.push({
            //     columns: [
            //         getColorSwatchElement(data),
            //         getLabelTextElement(texts[i])
            //     ],
            //     margin: [10, 0, 0, 0]
            // })
        }
        finalImage = canvas.toDataURL('image/png');
        return { image: finalImage };
    }

    return results;
}

function getLegendFromSvgHorizontal(legendSvg) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(legendSvg, "image/svg+xml");
    var g = doc.getElementsByTagName('g')[0];
    if(g) {
        var children = [].slice.call(g.childNodes);
        var texts = [];
        children.forEach(function(value, index, array) {
            if(value.tagName === 'text') {
                if(index === 0) {
                    texts.push(value.textContent);
                    return;
                }
                var previousValue = array[index - 1];
                //if the previous node was also text then combine the two because they are one label on
                // two separate lines
                if(previousValue.nodeName === value.nodeName) {
                    //remove the previousValue from the texts array
                    var previousString = texts.pop();
                    //add the combined values to the texts array
                    texts.push(previousString + value.textContent);
                    return;
                }
                texts.push(value.textContent);
            }
        });
        var images = g.getElementsByTagName('image');
        var table = {
            margin: [0, 400, 0, 0],
            table: {
                headerRows: 0,
                //widths: [10, 130],
                body: []
            },
            layout: {
                hLineWidth: function(i, node) { return 0; },
                vLineWidth: function(i, node) { return 0; },
                paddingLeft: function(i, node) { return 0; },
                paddingRight: function(i, node) { return 0; },
                paddingTop: function(i, node) { return 0; }
            }
        };
        var totalRealEstate = 750;
        var columnSize = 10;
        var totalColumns = Math.floor(totalRealEstate/columnSize);
        table.table.widths = pushValueOnArray('auto', [], totalColumns);
        var rows = [];
        var row = [];
        var rowsIdx = 0;
        var availableColumns = totalColumns;
        for(var i = 0; i < images.length; i++) {
            var imageData = images[i].getAttribute('xlink:href');
            var imageWidth = columnSize;//images[i].width.baseVal.value;
            var textWidth = texts[i].length * 5;//let's say each character is 5px wide

            var imageColSpan = Math.ceil(imageWidth/columnSize);
            var textColSpan = Math.ceil(textWidth/columnSize);
            var totalColumnsUsed = imageColSpan + textColSpan;
            var remainingColumns = availableColumns - totalColumnsUsed;
            if(remainingColumns >= 0) {
                // row.push({
                //     image: data,
                //     width: 10,
                //     height: 10,
                //     colSpan: imageColSpan
                // });
                // row = pushEmptyColumnsOnRow(row, imageColSpan - 1);
                // row.push({
                //     text: texts[i],
                //     fontSize: 8,
                //     colSpan: textColSpan
                // });
                // row = pushEmptyColumnsOnRow(row, textColSpan - 1);
                row = addImageAndTextToRow(row, imageData, imageWidth, imageColSpan, texts[i], textColSpan);
                availableColumns = remainingColumns;
            } else {
                if(availableColumns > 0) {
                    row.push({
                        text: '',
                        colSpan: availableColumns
                    });
                    row = pushValueOnArray('', row, availableColumns - 1);
                }
                rows[rowsIdx] = row;
                rowsIdx++;
                row = addImageAndTextToRow([], imageData, imageWidth, imageColSpan, texts[i], textColSpan);
                availableColumns = totalColumns - totalColumnsUsed;
            }
            //d results.push({
            //     columns: [
            //         getColorSwatchElement(data),
            //         getLabelTextElement(texts[i])
            //     ],
            //     margin: [10, 0, 0, 0]
            // })
        }
        //add the last row to the legend if there is one
        if(row.length) {
            row.push({
                text: '',
                colSpan: availableColumns
            });
            rows[rowsIdx] = pushValueOnArray('', row, totalColumns - row.length - 1);
        }

        table.table.body = rows;
        return table;
    }

    return [];
}

function getLegendImageFromSvg(legendSvg, callback) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    var DOMURL = window.URL || window.webkitURL || window;

    var img = new Image();
    var svg = new Blob([legendSvg], {type: 'image/svg+xml;charset=utf-8'});
    var url = DOMURL.createObjectURL(svg);

    // var imageUri = '';
    img.onload = function () {
        ctx.drawImage(img, 0, 0);
        DOMURL.revokeObjectURL(url);
        callback({image: canvas.toDataURL("image/png")});
        return {image: canvas.toDataURL("image/png")};
    };


    img.src = url;

    // return {
    //     image: imageUri
    // };
    // var parser = new DOMParser();
    // var doc = parser.parseFromString(legendSvg, "image/svg+xml");
    // var g = doc.getElementsByTagName('g')[0];
    // if(g) {
    //     var children = [].slice.call(g.childNodes);
    //     var texts = [];
    //     children.forEach(function(value, index, array) {
    //         if(value.tagName === 'text') {
    //             if(index === 0) {
    //                 texts.push(value.textContent);
    //                 return;
    //             }
    //             var previousValue = array[index - 1];
    //             //if the previous node was also text then combine the two because they are one label on
    //             // two separate lines
    //             if(previousValue.nodeName === value.nodeName) {
    //                 //remove the previousValue from the texts array
    //                 var previousString = texts.pop();
    //                 //add the combined values to the texts array
    //                 texts.push(previousString + value.textContent);
    //                 return;
    //             }
    //             texts.push(value.textContent);
    //         }
    //     });
    //     var images = g.getElementsByTagName('image');
    //     var table = {
    //         table: {
    //             headerRows: 0,
    //             //widths: [10, 130],
    //             body: []
    //         },
    //         layout: {
    //             // hLineWidth: function(i, node) { return 0; },
    //             // vLineWidth: function(i, node) { return 0; },
    //             paddingLeft: function(i, node) { return 0; },
    //             paddingRight: function(i, node) { return 0; },
    //             paddingTop: function(i, node) { return 0; }
    //         }
    //     };
    //     var totalRealEstate = 750;
    //     var columnSize = 10;
    //     var totalColumns = Math.floor(totalRealEstate/columnSize);
    //     table.table.widths = pushValueOnArray('auto', [], totalColumns);
    //     var rows = [];
    //     var row = [];
    //     var rowsIdx = 0;
    //     var availableColumns = totalColumns;
    //     for(var i = 0; i < images.length; i++) {
    //         var imageData = images[i].getAttribute('xlink:href');
    //         var imageWidth = columnSize;//images[i].width.baseVal.value;
    //         var textWidth = texts[i].length * 5;//let's say each character is 5px wide
    //
    //         var imageColSpan = Math.ceil(imageWidth/columnSize);
    //         var textColSpan = Math.ceil(textWidth/columnSize);
    //         var totalColumnsUsed = imageColSpan + textColSpan;
    //         var remainingColumns = availableColumns - totalColumnsUsed;
    //         if(remainingColumns >= 0) {
    //             // row.push({
    //             //     image: data,
    //             //     width: 10,
    //             //     height: 10,
    //             //     colSpan: imageColSpan
    //             // });
    //             // row = pushEmptyColumnsOnRow(row, imageColSpan - 1);
    //             // row.push({
    //             //     text: texts[i],
    //             //     fontSize: 8,
    //             //     colSpan: textColSpan
    //             // });
    //             // row = pushEmptyColumnsOnRow(row, textColSpan - 1);
    //             row = addImageAndTextToRow(row, imageData, imageWidth, imageColSpan, texts[i], textColSpan);
    //             availableColumns = remainingColumns;
    //         } else {
    //             if(availableColumns > 0) {
    //                 row.push({
    //                     text: '',
    //                     colSpan: availableColumns
    //                 });
    //                 row = pushValueOnArray('', row, availableColumns - 1);
    //             }
    //             rows[rowsIdx] = row;
    //             rowsIdx++;
    //             row = addImageAndTextToRow([], imageData, imageWidth, imageColSpan, texts[i], textColSpan);
    //             availableColumns = totalColumns - totalColumnsUsed;
    //         }
    //         //d results.push({
    //         //     columns: [
    //         //         getColorSwatchElement(data),
    //         //         getLabelTextElement(texts[i])
    //         //     ],
    //         //     margin: [10, 0, 0, 0]
    //         // })
    //     }
    //     //add the last row to the legend if there is one
    //     if(row.length) {
    //         row.push({
    //             text: '',
    //             colSpan: availableColumns
    //         });
    //         rows[rowsIdx] = pushValueOnArray('', row, totalColumns - row.length - 1);
    //     }
    //
    //     table.table.body = rows;
    //     return table;
    // }
    //
    // return [];
}

function addImageAndTextToRow(row, imageData, imageWidth, imageColSpan, text, textColSpan) {
    row.push({
        image: imageData,
        width: imageWidth,
        height: imageWidth,
        colSpan: imageColSpan
    });
    row = pushValueOnArray('', row, imageColSpan - 1);
    row.push({
        text: text,
        fontSize: 8,
        colSpan: textColSpan
    });
    row = pushValueOnArray('', row, textColSpan - 1);
    return row;
}

function pushValueOnArray(value, array, numberOfTimes) {
    for(var i = 0; i < numberOfTimes; i++) {//minus one because one column is defined by the actual text
        array.push(value);
    }
    return array;
}

function getLabelTextElement(text) {
    return {
        text: text,
        fontSize: 6,
        fillColor: '#FFFFFF'
    };
}

function getColorSwatchElement(data) {
    return {
        image: data,
        width: 10,
        height: 10,
        fillColor: 'white'
    };
}

module.exports = SharePopupViewModel;
