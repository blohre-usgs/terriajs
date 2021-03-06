'use strict';

import d3 from 'd3';

import defaultValue from 'terriajs-cesium/Source/Core/defaultValue';
import defined from 'terriajs-cesium/Source/Core/defined';

const defaultClassName = 'linechart-title';
const defaultHeight = 30; // The additional height of the title, which may in fact be the legend.

/**
 * Handles the drawing of the chart title, which may be a string or a legend.
 *
 * @param  {String} [titleSettings.type='string'] May be 'string' or 'legend'.
 * @param  {String} [titleSettings.title] For 'string'-type titles, the title.
 * @param  {String} [titleSettings.className] The className to use for the title DOM element. Defaults to 'linechart-title'.
 * @param  {Number} [titleSettings.height=defaultTitleHeight] The height of the title bar.
 */
const Title = {

    className(titleSettings) {
        return (titleSettings && titleSettings.className) ? titleSettings.className : defaultClassName;
    },

    getHeight(titleSettings) {
        return defaultValue(defined(titleSettings) ? titleSettings.height : 0, defaultHeight);
    },

    create(d3Element, titleSettings) {
        // For a nicely centered title, use css:  .chart-title {left: 0, right: 0, text-align: center;} and maybe {margin: 0 auto;}.
        d3Element.append('div')
            .attr('class', Title.className(titleSettings))
            .style('opacity', 1e-6)
            .style('position', 'absolute');
    },

    enterUpdateAndExit(d3Element, titleSettings, margin, data, transitionDuration) {
        // The title might be the legend, or a simple string.
        const title = d3Element.select('.' + Title.className(titleSettings))
            .style('top', margin.top + 'px');
        title
            .transition().duration(transitionDuration)
            .style('opacity', Title.getHeight(titleSettings) > 0 ? 1 : 1e-6);
        if (defined(titleSettings)) {
            let titleData = data;
            if (titleSettings.type === 'string') {
                titleData = [{id: '_string__', name: titleSettings.title}];
            }
            const titleComponents = title.selectAll('.title-component').data(titleData, d=>d.id);
            // Check whether there are multiple category names and/or column names.
            const numberOfCategories = d3.nest().key(d=>d.categoryName).entries(titleData).length;
            const numberOfColumnNames = d3.nest().key(d=>d.name).entries(titleData).length;
            // This is to only show the interesting parts of the name & categoryName in the title,
            // similar to Tooltip.js.
            const getName = function(d, index) {
                if (!d.categoryName) {
                    return d.name;
                }
                if (titleData.length === 1) {
                    return d.categoryName;
                }
                if (numberOfColumnNames === 1) {
                    return d.categoryName + ((index === 0) ? ' ' + d.name : '');
                }
                if (numberOfCategories === 1) {
                    return ((index === 0) ? d.categoryName + ' ' : '') + d.name;
                }
                return d.categoryName + ' ' + d.name;
            };
            // Enter.
            const addedTitleComponents = titleComponents.enter().append('span')
                .attr('class', 'title-component');
            if (titleSettings.type === 'legend') {
                addedTitleComponents.append('span')
                    .attr('class', 'color');
            }
            addedTitleComponents.append('span')
                .attr('class', 'name');
            // Enter and update.
            titleComponents.select('.color').style('background-color', d=>d.color);
            titleComponents.select('.name').text(getName);
            // Exit.
            titleComponents.exit().remove();
        }
    }

};


module.exports = Title;
