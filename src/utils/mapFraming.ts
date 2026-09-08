// Framing and projection for the static map, so the page can lay its own
// badges over Google's image.
//
// Google's Static Maps API draws markers itself, and for this page that was
// the wrong tool three times over: its labels are one character, custom icons
// are doubled by scale=2 and can never match a 28 CSS pixel badge at every
// screen width, and a request carries at most FIVE unique custom icons, so a
// packed day drew home and 1 to 4 as circles and 5 to 9 as Google's red
// default pin. So Google draws the tiles and the route line only, and the
// badges are the same React component as the numbered circles in the list,
// placed at the projected pixel and nudged apart when two stops share a corner.
//
// This is the Web Mercator projection Google uses, at integer zoom, with a
// world of 256 * 2^zoom pixels. The image is requested at the map box's own
// aspect ratio so nothing is cropped and a projected pixel lands where it
// should (Akber, 8 Sep 2026).

export type LatLng = { lat: number; lng: number }

// Matches MAP_WIDTH / MAP_HEIGHT in api/static-map.ts and the 361:241 box in
// components.css. Change all three together.
export const MAP_WIDTH = 640
export const MAP_HEIGHT = 427

const TILE = 256
const MAX_ZOOM = 18
const MIN_ZOOM = 2

function worldSize(zoom: number) {
  return TILE * Math.pow(2, zoom)
}

function toWorld(point: LatLng, zoom: number) {
  const size = worldSize(zoom)
  const sinLat = Math.min(Math.max(Math.sin((point.lat * Math.PI) / 180), -0.9999), 0.9999)
  return {
    x: ((point.lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size,
  }
}

function fromWorld(x: number, y: number, zoom: number): LatLng {
  const size = worldSize(zoom)
  const lng = (x / size) * 360 - 180
  const lat = (Math.atan(Math.sinh((0.5 - y / size) * 2 * Math.PI)) * 180) / Math.PI
  return { lat, lng }
}

export type Framing = { center: LatLng; zoom: number }

// The largest integer zoom at which every point fits inside the image with
// `padding` pixels to spare on each side, centred on the middle of the points
// in projected space (not the middle of their latitudes, which drifts at
// Tokyo's latitude).
export function frame(points: LatLng[], padding = 40): Framing | null {
  if (points.length === 0) return null
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const world = points.map((p) => toWorld(p, zoom))
    const minX = Math.min(...world.map((w) => w.x))
    const maxX = Math.max(...world.map((w) => w.x))
    const minY = Math.min(...world.map((w) => w.y))
    const maxY = Math.max(...world.map((w) => w.y))
    if (maxX - minX <= MAP_WIDTH - 2 * padding && maxY - minY <= MAP_HEIGHT - 2 * padding) {
      return { center: fromWorld((minX + maxX) / 2, (minY + maxY) / 2, zoom), zoom }
    }
  }
  return { center: points[0], zoom: MIN_ZOOM }
}

// Pixel position of a point within the image, for the framing above.
export function project(point: LatLng, framing: Framing) {
  const c = toWorld(framing.center, framing.zoom)
  const p = toWorld(point, framing.zoom)
  return { x: p.x - c.x + MAP_WIDTH / 2, y: p.y - c.y + MAP_HEIGHT / 2 }
}

export type Placed<T> = { x: number; y: number; data: T }

// Pushes badges apart until no two are closer than `minDistance`, in whatever
// unit the positions are in. A stop is moved only as far as it takes, along
// the line between the pair, so it stays beside where it belongs. Stops on
// exactly the same pixel are separated vertically. Bounded, so a dense day
// converges to something readable rather than looping.
export function spread<T>(placed: Placed<T>[], minDistance: number, bounds: { width: number; height: number }) {
  const out = placed.map((p) => ({ ...p }))
  for (let round = 0; round < 40; round++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x
        let dy = out[j].y - out[i].y
        let d = Math.hypot(dx, dy)
        if (d >= minDistance) continue
        if (d < 0.01) { dx = 0; dy = 1; d = 1 }
        const push = (minDistance - d) / 2 + 0.25
        const ux = dx / d
        const uy = dy / d
        out[i].x -= ux * push; out[i].y -= uy * push
        out[j].x += ux * push; out[j].y += uy * push
        moved = true
      }
    }
    for (const p of out) {
      p.x = Math.min(Math.max(p.x, minDistance / 2), bounds.width - minDistance / 2)
      p.y = Math.min(Math.max(p.y, minDistance / 2), bounds.height - minDistance / 2)
    }
    if (!moved) break
  }
  return out
}
