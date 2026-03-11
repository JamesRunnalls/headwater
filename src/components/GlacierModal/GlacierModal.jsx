import { useState, useEffect } from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import GlacierMorph from "../GlacierMorph/GlacierMorph";
import "./GlacierModal.css";

const GlacierModal = ({ properties, onClose }) => {
  const name = properties?.name ?? "Glacier";
  const sgiId = properties?.["sgi-id"];
  const externalUrl = `https://glamos.ch/en/factsheet#/${sgiId}`;
  const hasLink = !!sgiId;

  const [glacierGeojson, setGlacierGeojson] = useState(null);

  useEffect(() => {
    if (!sgiId) return;
    setGlacierGeojson(null);
    fetch(`/geodata/outputs/glaciers/${sgiId}.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGlacierGeojson(data))
      .catch(() => {});
  }, [sgiId]);

  return (
    <FeatureModal label="GLACIER" name={name} onClose={onClose}>
      <GlacierMorph geojson={glacierGeojson} />
      {hasLink && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="glacier-modal-link"
        >
          View on GLAMOS →
        </a>
      )}
    </FeatureModal>
  );
};

export default GlacierModal;
