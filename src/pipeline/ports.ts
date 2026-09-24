import type {
  MatchDiscovery,
  OfficialMatchContext,
  InterpretedScoreSheet,
} from "../domain/schemas.js";
export interface ImageArtifact {
  path: string;
  sha256: string;
  mime_type: "image/jpeg" | "image/png";
}
export interface PreparedImage {
  original: ImageArtifact;
  prepared: ImageArtifact;
  operations: string[];
}
export interface ImagePreprocessor {
  prepare(original: ImageArtifact): Promise<PreparedImage>;
}
export interface VisionInterpreter {
  discover(image: PreparedImage): Promise<MatchDiscovery>;
  // Always provide the ORIGINAL image on pass 2, plus the immutable official snapshot.
  interpret(
    original: ImageArtifact,
    context: OfficialMatchContext,
  ): Promise<InterpretedScoreSheet>;
}
// These adapters are injection boundaries, not implemented model or image-processing services.
// Parse every adapter response with the domain schema before checkpointing.
