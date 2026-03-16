import FeatureModal from "../FeatureModal/FeatureModal";
import "./GlacierModal.css";

const GlacierModal = ({ properties, t = {}, onClose, onMouseEnter }) => {
  const name = properties?.name ?? "Glacier";
  const sgiId = properties?.["sgi-id"];
  const externalUrl = `https://glamos.ch/en/factsheet#/${sgiId}`;
  const hasLink = !!sgiId;

  return (
    <FeatureModal label={t.glacier} name={name} onClose={onClose} overlayClassName="modal-right" hideHeader onMouseEnter={onMouseEnter}>
      {hasLink && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="glacier-modal-link"
        >
          {t.viewOnGlamos}
        </a>
      )}
    </FeatureModal>
  );
};

export default GlacierModal;
