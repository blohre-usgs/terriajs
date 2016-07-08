/*global require*/
"use strict";

var defaultValue = require('terriajs-cesium/Source/Core/defaultValue');
var defineProperties = require('terriajs-cesium/Source/Core/defineProperties');
var defined = require('terriajs-cesium/Source/Core/defined');
var LegendUrl = require('./LegendUrl');

/**
 * Legend object for generating and displaying a legend.
 * Constructor: new Legend(props), where props is an object containing many properties.
 * Other than the "items" property, it is preferable to leave other properties to their defaults
 * for style consistency.
 */

var Legend = function(props) {
    props = defaultValue(props, {});

    this.title = props.title;

    /**
     * The maximum number of characters allowed on one line for the item label.
     * Use this to determine the last whole word before the character limit and split
     * the label into multiple pieces so all of the legend label is displayed to the user.
     * @type {Number}
     */
    this.singleLineCharacterCutoff = 40;

    /**
     * Gets or sets the list of items, ordered from bottom to top, with properties:
     * * `color`: CSS color description,
     * * `multipleColors`: An array of CSS color descriptions.  A grid of these colors will be displayed in the box to the left of the item label.
     * * `title`: label placed level with middle of box
     * * `titleAbove`: label placed level with top of box
     * * `titleBelow`: label placed level with bottom of box
     * * `imageUrl`: url of image that will be drawn instead of a coloured box
     * * `imageWidth`, `imageHeight`: image dimensions
     * * `spacingAbove`: adds to itemSpacing for this item only.
     * @type {Object[]}
     */
    this.items = defaultValue(props.items, []);

    /**
     * Gets or sets a color map used to draw a smooth gradient instead of discrete color boxes.
     * @type {ColorMap}
     */
    this.gradientColorMap = props.gradientColorMap;

    /**
     * Gets or sets the maximum height of the whole color bar, unless very many items.
     * @type {Number}
     * @default 130
     */
    this.barHeightMax = defaultValue(props.barHeightMax, 130);

    /**
     * Gets or sets the minimum height of the whole color bar.
     * @type {Number}
     * @default 30
     */
    this.barHeightMin = defaultValue(props.barHeightMax, 30);

    /**
     * Gets or sets the width of each color box (and hence, the color bar)
     * @type {Number}
     * @default 20
     */
    this.itemWidth = defaultValue(props.itemWidth, 20);

    /**
     * Gets or sets the absolute minimum height of each color box, overruling barHeightMax.
     * @type {Number}
     * @default 12
     */
    this.itemHeightMin = defaultValue(props.itemHeightMin, 12);

    /**
     * Gets or sets the forced height of each color box. Better to leave unset.
     * @type {Number}
     * @default the larger of `props.barHeightMax / props.items.length` and 20.
     */
    this.itemHeight = props.itemHeight;

    /**
     * Gets or sets the gap between each pair of color boxes.
     * @type {Number}
     * @default 5
     */
    this.itemSpacing = defaultValue(props.itemSpacing, 5);

    /**
     * Gets or sets the spacing to the left of the color bar.
     * @type {Number}
     * @default 5
     */
    this.barLeft = defaultValue(props.barLeft, 5);

    /**
     * Gets or sets the spacing above the color bar.
     * @type {Number}
     * @default 25
     */
    this.barTop = defaultValue(props.barTop, 25);

    /**
     * Gets or sets the forced total width of the legend.
     * @type {Number}
     * @default 210 or 300, depending on width of items
     */
    this.width = props.width;

    /**
     * Gets or sets the horizontal offset of variable title.
     * @type {Number}
     * @default 5
     */
    this.variableNameLeft = defaultValue(props.variableNameLeft, 5);

    /**
     * Gets or sets the vertical offset of variable title.
     * @type {Number}
     * @default 17
     */
    this.variableNameTop = defaultValue(props.variableNameTop, 17);

    this._svg = undefined;

};

defineProperties(Legend.prototype, {
    barHeight: {
        get: function() {
            var totalSpacingAbove = this.items.reduce(function(prev, item) { return prev + (item.spacingAbove || 0); }, 0);
            return Math.max((this.itemHeight + this.itemSpacing) * this.items.length + totalSpacingAbove, this.barHeightMin);
        }
    },
    height: {
        get: function() {
            return Math.max(this.barTop + this.barHeight + this.itemHeight / 2, 250); // add some spacing underneath
        }
    },
    width: {
        get: function() {
            return defaultValue(this._width, longestTitle(this) > 20 ? 300 : 210);
        },
        set: function(w) {
            this._width = w;
        }
    },
    itemHeight: {
        get: function() {
            return defaultValue(this._itemHeight, Math.max(Math.max(this.barHeightMax / this.items.length, 20), this.itemHeightMin));
        },
        set: function(h) {
            this._itemHeight = h;
        }
    }
});

function initSvg(legend) {
    legend._svgns = 'http://www.w3.org/2000/svg';
    legend._svg = document.createElementNS(legend._svgns, 'svg');
    legend._svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    legend._svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    legend._svg.setAttributeNS(legend._svgns, 'version', "1.1");
    legend._svg.setAttributeNS(legend._svgns, 'width', legend.width);
    legend._svg.setAttributeNS(legend._svgns, 'height', legend.height);
    legend._svg.setAttribute('style', 'height: ' + legend.height + 'px');
    legend._svg.setAttribute('class', 'generated-legend now-viewing-legend-image-background');
}

function finishSvg(legend) {
    // we create this temporary wrapper because IE doesn't allow innerHTML on SVG nodes.
    var temp = document.createElement('div');
    var node = legend._svg.cloneNode(true);
    temp.appendChild(node);
    return temp.innerHTML;
}


function addSvgElement(legend, element, attributes, className, innerText) {
    return legend._svg.appendChild(svgElement(legend, element, attributes, className, innerText));
}

function svgElement(legend, element, attributes, className, innerText) {
    var ele = document.createElementNS(legend._svgns, element);
    Object.keys(attributes).forEach(function(att) {
        ele.setAttribute(att, attributes[att]);
    });
    if (defined(innerText)) {
        ele.textContent = innerText;
    }
    if (defined(className)) {
        ele.setAttribute('class', className);
    }
    return ele;
}

/*
 * The name of the active data variable, drawn above the ramp or gradient.
 */
function drawVariableName(legend) {
    addSvgElement(legend, 'text', {
        x: legend.variableNameLeft,
        y: legend.variableNameTop
    }, 'variable-label', legend.title || '');
}


/* The older, non-quantised, smooth gradient. */
function drawGradient(legend, barGroup) {
    var defs = addSvgElement(legend, 'defs', {}); // apparently it's ok to have the defs anywhere in the doc
    var linearGradient = svgElement(legend, 'linearGradient', {
        x1: '0',
        x2: '0',
        y1: '1',
        y2: '0',
        id: 'gradient'
    });
    legend.gradientColorMap.forEach(function(c, i) {
        linearGradient.appendChild(svgElement(legend, 'stop', {
            offset: c.offset,
            'stop-color': c.color
        }));
    });
    defs.appendChild(linearGradient);
    addSvgElement(legend, 'rect', {
        x: legend.barLeft,
        y: legend.barTop,
        width: legend.itemWidth,
        height: legend.barHeight,
        fill: 'url(#gradient)'
    }, 'gradient-bar');
}

/**
 * Calculate the length, in characters, of the longest item title, titleAbove or titleBelow.
 * @private
 * @param  {Object} legend
 * @return {Number} Length in characters
 */
function longestTitle(legend) {
    return legend.items.reduce(function(max, item) {
        return Math.max(max, defaultValue(item.titleAbove, '').length, defaultValue(item.title, '').length, defaultValue(item.titleBelow, '').length);
    }, 0);
}

/*
 * Label the thresholds between bins for numeric columns, or the color boxes themselves in other cases.
 */
function drawItemBoxesAndLabels(legend, barGroup) {
    // draw a subtle tick to help indicate what the label refers to
    function drawTick (y) {
        barGroup.appendChild(svgElement(legend, 'line', {
            x1: legend.itemWidth,
            x2: legend.itemWidth + 5,
            y1: y,
            y2: y
        }, 'tick-mark'));
    }

    function drawBox(y, item, textOffsetY) {
        textOffsetY = defaultValue(textOffsetY, 0);
        if (defined(item.imageUrl)) {
            barGroup.appendChild(svgElement(legend, 'image', {
                'xlink:href': item.imageUrl,
                x: 0,
                y: y - textOffsetY,
                width: Math.min(item.imageWidth, legend.itemWidth + 4), // let them overlap slightly
                height: Math.min(item.imageHeight, legend.itemHeight + 4)
            }, 'item-icon'));
            return;
        }

        if (!defined(item.color)) {
            return;
        }
        barGroup.appendChild(svgElement(legend, 'rect', {
            fill: item.color,
            x: 0,
            y: y - textOffsetY,
            width: legend.itemWidth,
            height: legend.itemHeight
        }, 'item-box'));
    }

    function getSubStringsWithWholeWords(str, maxLength) {
        var result = [];
        while(str.length > 0) {
            if(maxLength >= str.length) {
                result.push(str);
                return result;
            }
            var strSlice = str.slice(0, maxLength);
            var endOfLastWord = Math.min(strSlice.length, strSlice.lastIndexOf(" "));
            var strSegment = str.slice(0, endOfLastWord);
            result.push(strSegment);
            str = str.slice(endOfLastWord, str.length);
        }
        return result;
    }

    function drawLabel(y, text, textOffsetY) {
        var textOffsetX = 7;
        textOffsetY = defaultValue(textOffsetY, 3); // pixel shuffling to get the text to line up just right.
        if(text.length > legend.singleLineCharacterCutoff) {
            var strings = getSubStringsWithWholeWords(text, legend.singleLineCharacterCutoff);
            y = y + 5 + textOffsetY;
            strings.forEach(function(str, i) {
                if(i !== 0) {
                    y = y + textOffsetY + 10;
                }
                barGroup.appendChild(svgElement(legend, 'text', {
                    x: legend.itemWidth + textOffsetX,
                    y: y
                }, 'item-label', strings[i]));
            });
        } else {
            y = y + 9 + textOffsetY;
            barGroup.appendChild(svgElement(legend, 'text', {
                x: legend.itemWidth + textOffsetX,
                y: y
            }, 'item-label', text));
        }
        return y;
    }

    var y = 0;
    legend.items.forEach(function(item) {
        if (defined(item.titleAbove)) {
            y = drawLabel(y, item.titleAbove);
            drawTick(y);
        }
        if (defined(item.title)) {
            var startingY = y + legend.itemHeight / 2;
            var textOffsetY = 3; // pixel shuffling to get the text to line up just right.
            drawBox(startingY, item, textOffsetY);
            y = drawLabel(startingY, item.title, textOffsetY);
        }
        if (defined(item.titleBelow)) {
            y = drawLabel(y + legend.itemHeight, item.titleBelow);
            drawTick(y + legend.itemHeight);
        }
    });
}

function drawBackground(legend) {
    addSvgElement(legend, 'rect', {
        x: 0,
        y: 0,
        width: legend.width,
        height: legend.height
    }, 'background'); // same class as in LegendSection.html
}

/**
 * Generate legend and return it as an SVG string
 * @return {String}
 */
Legend.prototype.drawSvg = function() {
    initSvg(this);
    drawBackground(this);
    drawVariableName(this);
    var barGroup = addSvgElement(this, 'g', {
        transform: 'translate(' + this.barLeft + ',' + this.barTop + ')'
    }, 'legend-bar-group');
    if (defined(this.gradientColorMap)) {
        drawGradient(this, barGroup);
    }
    if (this.items.length > 0) {
        drawItemBoxesAndLabels(this, barGroup);
    }

    return finishSvg(this);
};

/**
 * Generate legend and return it as a data URI containing an SVG. Note that this SVG does
 * not contain inline styles.
 * @return {String}
 */
Legend.prototype.asSvgUrl = function() {
    return "data:image/svg+xml," + this.drawSvg();
};

/**
 * Return a LegendUrl object which actually contains the SVG as a property, .safeSvgContent.
 */
Legend.prototype.getLegendUrl = function() {
    var svg = this.drawSvg();
    var legendUrl = new LegendUrl('data:image/svg+xml,' + svg, 'image/svg+xml');
    legendUrl.safeSvgContent = svg;
    return legendUrl;
};

module.exports = Legend;

