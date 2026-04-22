import React, { useState, useRef, useEffect, useCallback } from "react";
import { Map as MapGL, Source, Layer } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { INITIAL_VIEW_STATE, MAP_STYLE, HILLSHADE_FADE_MS } from "./constants";
import CONFIG from "../../config.json";

// Owns viewState so drag only re-renders this small component, not home.jsx.
const MapCanvas = React.memo(({
  layers,
  flyTarget,
  onFlyApplied,
  hillshadeKey,
  hillshadeOpacity,
  hillshadeBounds,
  glacierThicknessKey,
  mapDraggingRef,
  onMapHover,
  onMapClick,
  onMapIdle,
  onInteractionStart,
  onZoomChange,
}) => {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const isDraggingRef = useRef(false);
  const prevZoomRef = useRef(INITIAL_VIEW_STATE.zoom);
  const zoomEndTimerRef = useRef(null);

  useEffect(() => {
    if (flyTarget) {
      setViewState((prev) => ({ ...prev, ...flyTarget }));
      onFlyApplied?.();
    }
  }, [flyTarget, onFlyApplied]);

  const handleViewStateChange = useCallback(({ viewState: vs, interactionState }) => {
    setViewState(vs);
    const active = !!(
      interactionState?.isDragging ||
      interactionState?.isPanning ||
      interactionState?.isZooming ||
      interactionState?.isRotating
    );
    isDraggingRef.current = active;
    if (mapDraggingRef) mapDraggingRef.current = active;
    if (active) onInteractionStart?.();
    // DeckGL doesn't always fire a terminal isZooming:false after scroll zoom,
    // so debounce-reset the dragging flag once zoom events stop arriving.
    if (interactionState?.isZooming) {
      clearTimeout(zoomEndTimerRef.current);
      zoomEndTimerRef.current = setTimeout(() => {
        isDraggingRef.current = false;
        if (mapDraggingRef) mapDraggingRef.current = false;
      }, 200);
    }
    if (vs.zoom !== prevZoomRef.current) {
      prevZoomRef.current = vs.zoom;
      onZoomChange?.(vs.zoom);
    }
  }, [onInteractionStart, onZoomChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHover = useCallback((info) => {
    if (!isDraggingRef.current) onMapHover?.(info, viewState.zoom);
  }, [onMapHover, viewState.zoom]);

  const handleClick = useCallback((info) => {
    onMapClick?.(info, viewState.zoom);
  }, [onMapClick, viewState.zoom]);

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={handleViewStateChange}
      controller={{ minZoom: 6, maxZoom: 14 }}
      layers={layers}
      pickingRadius={10}
      onHover={handleHover}
      onClick={handleClick}
      getCursor={({ isDragging, isHovering }) => isDragging ? "grabbing" : isHovering ? "pointer" : "grab"}
    >
      <MapGL
        mapStyle={MAP_STYLE}
        onIdle={onMapIdle}
      >
        {hillshadeKey && (
          <Source
            key={`hillshade-${hillshadeKey}`}
            id="hillshade"
            type="raster"
            tiles={[`${CONFIG.bucket}/tiles_${hillshadeKey}_hillshade/{z}/{x}/{y}.png`]}
            tileSize={256}
            bounds={hillshadeBounds}
          >
            <Layer
              id="hillshade-layer"
              type="raster"
              beforeId="place_city"
              paint={{
                "raster-opacity": hillshadeOpacity,
                "raster-opacity-transition": { duration: HILLSHADE_FADE_MS, delay: 0 },
              }}
            />
          </Source>
        )}
        {hillshadeKey && (
          <Source
            key={`terrain-${hillshadeKey}`}
            id="terrain"
            type="raster"
            tiles={[`${CONFIG.bucket}/tiles_${hillshadeKey}_terrain/{z}/{x}/{y}.png`]}
            tileSize={256}
            bounds={hillshadeBounds}
          >
            <Layer id="terrain-layer" type="raster" beforeId="place_city" paint={{ "raster-opacity": 0 }} />
          </Source>
        )}
        {glacierThicknessKey && (
          <Source
            id="glacier-depth-terrain"
            type="raster"
            tiles={[`${CONFIG.bucket}/tiles_glacier_depth_terrain/{z}/{x}/{y}.png`]}
            tileSize={256}
          >
            <Layer id="glacier-depth-terrain-layer" type="raster" beforeId="place_city" paint={{ "raster-opacity": 0 }} />
          </Source>
        )}
      </MapGL>
    </DeckGL>
  );
});

export default MapCanvas;
