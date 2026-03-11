import { useState, useEffect } from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import GlacierMorph from "../GlacierMorph/GlacierMorph";
import "./GlacierModal.css";

const GlacierModal = ({ properties, onClose }) => {
  const name = properties?.name ?? "Glacier";
  const sgiId = properties?.["sgi-id"];
  const externalUrl = `https://glamos.ch/en/factsheet#/${sgiId}`;
  const hasLink = !!sgiId;

  const [morphFrames, setMorphFrames] = useState(null);

  useEffect(() => {
    if (!sgiId) return;
    setMorphFrames(null);
    fetch(`/geodata/outputs/glaciers/${sgiId}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMorphFrames(data))
      .catch(() => {});
  }, [sgiId]);

  return (
    <FeatureModal label="GLACIER" name={name} onClose={onClose}>
      <GlacierMorph frames={morphFrames} />
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
