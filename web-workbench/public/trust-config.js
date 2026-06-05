// Optional deployment trust anchor.
//
// For local development this stays disabled. For a public deployment, replace
// these values with the GitHub-hosted release manifest URLs and the ECDSA P-256
// public key described in docs/DEPLOYMENT.md.
window.SINGULAR_WORKBENCH_TRUST = {
  releaseManifestUrl: '',
  releaseSignatureUrl: '',
  publicKeyPem: ''
};
