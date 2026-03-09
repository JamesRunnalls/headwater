import React from "react";

const LakeGlacierModal = ({ type, properties, onClose }) => {
  const isLake = type === "lake";
  const name = properties?.name ?? (isLake ? "Lake" : "Glacier");
  const externalUrl = isLake
    ? `https://www.alplakes.eawag.ch/en/lake/${properties?.key}`
    : `https://glamos.ch/en/factsheet#/${properties?.["sgi-id"]}`;
  const hasLink = isLake ? !!properties?.key : !!properties?.["sgi-id"];
  const linkLabel = isLake ? "View on Alplakes" : "View on GLAMOS";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1e1e1e",
          border: "1px solid #444",
          borderRadius: 8,
          padding: "24px 28px",
          color: "#ddd",
          minWidth: 280,
          maxWidth: 400,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#888", marginBottom: 4 }}>
              {isLake ? "LAKE" : "GLACIER"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#eee" }}>{name}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#aaa",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
              marginLeft: 16,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            width: "100%",
            height: 1,
            background: "#333",
            marginBottom: 16,
          }}
        />

        {hasLink && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              padding: "8px 16px",
              background: isLake ? "rgba(70, 150, 220, 0.15)" : "rgba(204, 225, 239, 0.15)",
              border: `1px solid ${isLake ? "rgba(70, 150, 220, 0.4)" : "rgba(204, 225, 239, 0.4)"}`,
              borderRadius: 4,
              color: isLake ? "#4696dc" : "#cce1ef",
              fontSize: 12,
              letterSpacing: "0.1em",
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            {linkLabel} →
          </a>
        )}
      </div>
    </div>
  );
};

export default LakeGlacierModal;
