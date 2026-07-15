import { useState } from 'react'
import PhotoPlaceholder from './PhotoPlaceholder'
import LoadingSpinner from './LoadingSpinner'

// Shared photo slot for everywhere a place/hotel photo can appear (place
// cards, comparison cards, hotel cards, Accommodation, Finalise, Swap, Map).
// Replaces the `{photoUrl ? <img .../> : <PhotoPlaceholder />}` ternary that
// was duplicated across six screens, and adds a spinner overlay on the gray
// background while the image is actually loading - previously that gray CSS
// background just sat there with no indication anything was happening until
// the browser finished painting. Also falls back to PhotoPlaceholder if the
// image URL itself 404s/errors, not only when there's no URL at all.
// shape picks which of PhotoPlaceholder's two Figma illustrations to use
// when there's no photo - 'rect' (default) for wide 309/174 slots, 'square'
// for anything narrower/taller like comparison-card__photo's 70x90 box.
export default function PlacePhoto({ src, alt, className, shape = 'rect' }) {
  const [status, setStatus] = useState('loading') // loading | loaded | error

  if (!src || status === 'error') {
    return <PhotoPlaceholder className={className} shape={shape} />
  }

  return (
    <div className={`photo-frame ${className || ''}`.trim()}>
      <img
        className={`photo-frame__img${status === 'loaded' ? ' photo-frame__img--loaded' : ''}`}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
      {status === 'loading' && (
        <span className="photo-frame__spinner">
          <LoadingSpinner />
        </span>
      )}
    </div>
  )
}
