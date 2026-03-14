import React from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import "./LakeModal.css";

const LakeModal = ({ properties, t = {}, onClose, onMouseEnter }) => {
  const name = properties?.name ?? "Lake";
  const externalUrl = `https://www.alplakes.eawag.ch/${properties?.key}`;
  const hasLink = !!properties?.key;

  return (
    <FeatureModal label={t.lake} name={name} onClose={onClose} overlayClassName="modal-bottom" hideHeader onMouseEnter={onMouseEnter}>
      {hasLink && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="lake-modal-link"
        >
          {t.viewOnAlplakes}
        </a>
      )}
    </FeatureModal>
  );
};

export default LakeModal;
