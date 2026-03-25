import FeatureModal from "../FeatureModal/FeatureModal";
import "./LakeModal.css";

const LakeModal = ({ properties, t = {}, onClose, onMouseEnter }) => {
  const name = properties?.name ?? "Lake";
  const externalUrl = `https://www.alplakes.eawag.ch/${properties?.key}`;
  const hasLink = !!properties?.key;

  return (
    <FeatureModal label={t.lake} name={name} onClose={onClose} overlayClassName="modal-right" hideHeader overlayHandle onMouseEnter={onMouseEnter}>
      <div className="lake-modal-hero">
        <div className="lake-modal-image" />
        <div className="lake-modal-badge">
          <span className="lake-modal-badge-icon" />
          13 degC
        </div>
      </div>
      <div className="lake-modal-stats">
        <div className="lake-modal-stat">
          <span className="lake-modal-stat-icon" />
          <div>
            <div className="lake-modal-stat-value">580 km²</div>
            <div className="lake-modal-stat-label">Surface area</div>
          </div>
        </div>
        <div className="lake-modal-stat lake-modal-stat--empty" />
        <div className="lake-modal-stat lake-modal-stat--empty" />
      </div>
      <p className="lake-modal-description">
        Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.
      </p>
      {hasLink && (
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="lake-modal-link">
          {t.viewOnAlplakes || "View on Alplakes"}
        </a>
      )}
    </FeatureModal>
  );
};

export default LakeModal;
