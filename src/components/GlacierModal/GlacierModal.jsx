import FeatureModal from "../FeatureModal/FeatureModal";
import "./GlacierModal.css";

const GlacierModal = ({ properties, t = {}, onClose, onMouseEnter }) => {
  const name = properties?.name ?? "Glacier";
  const sgiId = properties?.["sgi-id"];
  const externalUrl = `https://glamos.ch/en/factsheet#/${sgiId}`;
  const hasLink = !!sgiId;

  return (
    <FeatureModal label={t.glacier} name={name} onClose={onClose} overlayClassName="modal-right" hideHeader overlayHandle onMouseEnter={onMouseEnter}>
      <div className="glacier-modal-hero">
        <div className="glacier-modal-image" />
        <div className="glacier-modal-badge">
          <span className="glacier-modal-badge-icon" />
          3 200 m
        </div>
      </div>
      <div className="glacier-modal-stats">
        <div className="glacier-modal-stat">
          <span className="glacier-modal-stat-icon" />
          <div>
            <div className="glacier-modal-stat-value">12.4 km²</div>
            <div className="glacier-modal-stat-label">Surface area</div>
          </div>
        </div>
        <div className="glacier-modal-stat glacier-modal-stat--empty" />
        <div className="glacier-modal-stat glacier-modal-stat--empty" />
      </div>
      <p className="glacier-modal-description">
        Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.
      </p>
      {hasLink && (
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="glacier-modal-link">
          {t.viewOnGlamos || "View on Glamos"}
        </a>
      )}
    </FeatureModal>
  );
};

export default GlacierModal;
