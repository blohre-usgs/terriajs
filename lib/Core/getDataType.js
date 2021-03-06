module.exports = function (){
  return {
    remoteDataType: [
            {
                value: 'auto',
                name: 'Auto-detect (recommended)'
            },
            {
                value: 'wms-getCapabilities',
                name: 'Web Map Service (WMS) Server'
            },
            {
                value: 'wmts-getCapabilities',
                name: 'Web Map Tile Service (WMTS) Server'
            },
            {
                value: 'wfs-getCapabilities',
                name: 'Web Feature Service (WFS) Server'
            },
            {
                value: 'esri-group',
                name: 'Esri ArcGIS Server'
            },
            {
                value: 'open-street-map',
                name: 'Open Street Map Server'
            },
            {
                value: 'geojson',
                name: 'GeoJSON'
            },
            {
                value: 'kml',
                name: 'KML or KMZ'
            },
            {
                value: 'csv',
                name: 'CSV'
            },
            {
                value: 'czml',
                name: 'CZML'
            },
            {
                value: 'gpx',
                name: 'GPX'
            },
            {
                value: 'other',
                name: 'Other (use conversion service)'
            },
        ],
    localDataType: [
          {
              value: 'auto',
              name: 'Auto-detect (recommended)'
          },
          {
              value: 'geojson',
              name: 'GeoJSON',
              extensions: ['geojson']
          },
          {
              value: 'kml',
              name: 'KML or KMZ',
              extensions: ['kml', 'kmz']
          },
          {
              value: 'csv',
              name: 'CSV',
              extensions: ['csv']
          },
          {
              value: 'czml',
              name: 'CZML',
              extensions: ['czml']
          },
          {
              value: 'gpx',
              name: 'GPX',
              extensions: ['gpx']
          },
          {
              value: 'other',
              name: 'Other (use conversion service)'
          },
      ]
    };
};


