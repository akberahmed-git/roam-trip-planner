// Same visual spinner as the Generating/Accommodation checklist's active
// step (a rotating ring, border-only, no SVG) - reused here for the
// photo-loading overlay (PlacePhoto) and Home's trending-locations skeleton,
// just a bit larger by default so it reads clearly centered on a photo.
export default function LoadingSpinner({ size = 32 }) {
  return <span className="loading-spinner" style={{ width: size, height: size }} />
}
