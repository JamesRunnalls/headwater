import { useRef, useEffect } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./GlacierMorph.css";

const INVENTORY_COLORS = {
  1850: "#0e3850",
  1931: "#306878",
  1973: "#7aa0b0",
  2010: "#c0d4dc",
  2016: "#ffffff",
};

function yearColor(year, years) {
  if (INVENTORY_COLORS[year]) return INVENTORY_COLORS[year];
  const idx = years.indexOf(year);
  const t = years.length > 1 ? idx / (years.length - 1) : 0;
  const r = Math.round(0x0e + (0xff - 0x0e) * t);
  const g = Math.round(0x38 + (0xff - 0x38) * t);
  const b = Math.round(0x50 + (0xff - 0x50) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const MAP_STYLE = {
  version: 8,
  transition: { duration: 0, delay: 0 },
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#1e1e1e" } },
  ],
};

const GlacierMorph = ({ geojson }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      interactive: true,
      attributionControl: false,
    });

    mapRef.current = map;

    if (!geojson || !geojson.features || geojson.features.length === 0) {
      return () => { map.remove(); mapRef.current = null; };
    }

    const features = [...geojson.features].sort(
      (a, b) => a.properties.year - b.properties.year
    );
    const years = features.map((f) => f.properties.year);
    const lastYear = years[years.length - 1];

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    function visitCoords(coords) {
      if (typeof coords[0] === "number") {
        if (coords[0] < minLng) minLng = coords[0];
        if (coords[0] > maxLng) maxLng = coords[0];
        if (coords[1] < minLat) minLat = coords[1];
        if (coords[1] > maxLat) maxLat = coords[1];
      } else {
        coords.forEach(visitCoords);
      }
    }
    features.forEach((f) => visitCoords(f.geometry.coordinates));

    map.on("load", () => {
      features.forEach((feature) => {
        map.addSource(`glacier-${feature.properties.year}`, { type: "geojson", data: feature });
      });

      // Invisible fill layers (oldest→newest) for full-polygon hover hit detection
      features.forEach((feature) => {
        const year = feature.properties.year;
        map.addLayer({
          id: `glacier-${year}-fill`,
          type: "fill",
          source: `glacier-${year}`,
          paint: { "fill-color": "#141414", "fill-opacity": year === lastYear ? 1 : 0, "fill-opacity-transition": { duration: 0, delay: 0 } },
        });
      });

      // Visible line layers — all spectrum colors; lastYear solid+prominent, others dashed
      features.forEach((feature) => {
        const year = feature.properties.year;
        const isLast = year === lastYear;
        const color = yearColor(year, years);
        map.addLayer({
          id: `glacier-${year}-line`,
          type: "line",
          source: `glacier-${year}`,
          paint: {
            "line-color": color,
            "line-width": 1,
            "line-opacity": isLast ? 0.9 : 0.55,
            ...(!isLast ? { "line-dasharray": [4, 2] } : {}),
            "line-opacity-transition": { duration: 0, delay: 0 },
          },
        });
      });

      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 0, animate: false }
      );

      const yearLabel = document.createElement("div");
      yearLabel.className = "glacier-year-label";
      containerRef.current?.appendChild(yearLabel);

      const areaLabel = document.createElement("div");
      areaLabel.className = "glacier-area-label";
      containerRef.current?.appendChild(areaLabel);

      // Precompute area in km² for each year
      const areaByYear = {};
      features.forEach((f) => {
        const geom = f.geometry;
        const rings = geom.type === "Polygon"
          ? [geom.coordinates[0]]
          : geom.coordinates.map((p) => p[0]);
        let total = 0;
        for (const ring of rings) {
          let a = 0;
          for (let i = 0; i < ring.length - 1; i++) {
            a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
          }
          a = Math.abs(a) / 2;
          const meanLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
          total += a * 111.32 * 111.32 * Math.cos(meanLat * Math.PI / 180);
        }
        areaByYear[f.properties.year] = total;
      });

      const fillLayerIds = features.map((f) => `glacier-${f.properties.year}-fill`);
      let activeYear = null;

      const resetLine = (year) => {
        if (year === null) return;
        const isLast = year === lastYear;
        map.setPaintProperty(`glacier-${year}-line`, "line-opacity", isLast ? 0.9 : 0.55);
        map.setPaintProperty(`glacier-${year}-line`, "line-dasharray", isLast ? null : [4, 2]);
        map.setPaintProperty(`glacier-${year}-fill`, "fill-opacity", year === lastYear ? 1 : 0);
      };

      const highlightLine = (year) => {
        map.setPaintProperty(`glacier-${year}-line`, "line-opacity", 1);
        map.setPaintProperty(`glacier-${year}-line`, "line-dasharray", null);
        map.setPaintProperty(`glacier-${year}-fill`, "fill-opacity", 1);
        if (year !== lastYear) {
          // revert lastYear to thin dashed while a historical year is active
          map.setPaintProperty(`glacier-${lastYear}-line`, "line-opacity", 0.35);
          map.setPaintProperty(`glacier-${lastYear}-line`, "line-dasharray", [4, 2]);
        }
      };

      const clearHover = () => {
        map.getCanvas().style.cursor = "";
        yearLabel.style.display = "none";
        areaLabel.style.display = "none";
        resetLine(activeYear);
        if (activeYear !== null && activeYear !== lastYear) {
          resetLine(lastYear);
        }
        activeYear = null;
      };

      map.on("mousemove", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: fillLayerIds });
        if (!hits.length) { clearHover(); return; }

        const topYear = hits[0].properties.year;
        map.getCanvas().style.cursor = "pointer";

        if (topYear !== activeYear) {
          resetLine(activeYear);
          if (activeYear !== null && activeYear !== lastYear) {
            resetLine(lastYear);
          }
          highlightLine(topYear);
          activeYear = topYear;
        }

        yearLabel.textContent = topYear;
        yearLabel.style.display = "block";

        const area = areaByYear[topYear];
        areaLabel.textContent = area != null ? `${area.toFixed(2)} km²` : "";
        areaLabel.style.display = "block";
      });

      map.on("mouseleave", clearHover);

      map.on("dblclick", () => {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 0, duration: 300 });
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [geojson]);

  return (
    <div className="glacier-morph">
      <div className="glacier-morph-map-container" ref={containerRef} />
    </div>
  );
};

export default GlacierMorph;
