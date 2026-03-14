import React from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import "./LakeModal.css";

const LakeModal = ({ properties, onClose }) => {
  const name = properties?.name ?? "Lake";
  const externalUrl = `https://www.alplakes.eawag.ch/${properties?.key}`;
  const hasLink = !!properties?.key;

  return (
    <FeatureModal label="LAKE" name={name} onClose={onClose} overlayClassName="modal-bottom" hideHeader>
      {hasLink && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="lake-modal-link"
        >
          View on Alplakes →
        </a>
      )}
    </FeatureModal>
  );
};

export default LakeModal;
