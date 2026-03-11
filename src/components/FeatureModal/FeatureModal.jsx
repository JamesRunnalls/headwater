import React from "react";
import "./FeatureModal.css";

const FeatureModal = ({ label, name, onClose, children }) => {
  return (
    <div className="feature-modal-overlay" onClick={onClose}>
      <div className="feature-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="feature-modal-header">
          <div>
            {label && <div className="feature-modal-label">{label}</div>}
            <div className="feature-modal-name">{name}</div>
          </div>
          <button className="feature-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="feature-modal-divider" />

        {children}
      </div>
    </div>
  );
};

export default FeatureModal;
