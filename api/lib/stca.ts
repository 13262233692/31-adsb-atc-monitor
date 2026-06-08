import type { RadarTrack } from './asterix.js'

export interface ConflictAlert {
  pair: [string, string]
  callsigns: [string, string]
  horizontalNm: number
  verticalFt: number
  timeToConflict: number
  severity: 'WARNING' | 'ALERT'
}

const EARTH_RADIUS_NM = 3440.065
const HORIZ_THRESHOLD_NM = 5
const VERT_THRESHOLD_FT = 1000
const PREDICTION_SECONDS = 120

function toRad(deg: number): number {
  return deg * Math.PI / 180
}

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_NM * c
}

function extrapolatePosition(track: RadarTrack, secondsAhead: number): { lat: number; lon: number; altitude: number } {
  const trackRad = toRad(track.track)
  const nmPerSec = track.groundSpeed / 3600
  const distNm = nmPerSec * secondsAhead
  const dLat = (distNm * Math.cos(trackRad)) / 60
  const avgLat = track.lat + dLat / 2
  const dLon = (distNm * Math.sin(trackRad)) / (60 * Math.cos(toRad(avgLat)))
  return {
    lat: track.lat + dLat,
    lon: track.lon + dLon,
    altitude: track.altitude + track.verticalRate * secondsAhead,
  }
}

export function detectConflicts(tracks: Map<string, RadarTrack>): ConflictAlert[] {
  const conflicts: ConflictAlert[] = []
  const trackList = Array.from(tracks.values())
  const n = trackList.length

  for (let i = 0; i < n; i++) {
    const a = trackList[i]
    const aFuture = extrapolatePosition(a, PREDICTION_SECONDS)

    for (let j = i + 1; j < n; j++) {
      const b = trackList[j]

      const hDist = haversineNm(a.lat, a.lon, b.lat, b.lon)
      const vDist = Math.abs(a.altitude - b.altitude)

      if (hDist < HORIZ_THRESHOLD_NM && vDist < VERT_THRESHOLD_FT) {
        conflicts.push({
          pair: [a.icao24, b.icao24],
          callsigns: [a.callsign || a.icao24, b.callsign || b.icao24],
          horizontalNm: Math.round(hDist * 100) / 100,
          verticalFt: Math.round(vDist),
          timeToConflict: 0,
          severity: 'ALERT',
        })
        continue
      }

      const hDistFuture = haversineNm(aFuture.lat, aFuture.lon, extrapolatePosition(b, PREDICTION_SECONDS).lat, extrapolatePosition(b, PREDICTION_SECONDS).lon)
      const vDistFuture = Math.abs(aFuture.altitude - b.altitude + b.verticalRate * PREDICTION_SECONDS)

      if (hDistFuture < HORIZ_THRESHOLD_NM && vDistFuture < VERT_THRESHOLD_FT) {
        let ttc = PREDICTION_SECONDS
        let lo = 0
        let hi = PREDICTION_SECONDS
        for (let iter = 0; iter < 8; iter++) {
          const mid = (lo + hi) / 2
          const aMid = extrapolatePosition(a, mid)
          const bMid = extrapolatePosition(b, mid)
          const hMid = haversineNm(aMid.lat, aMid.lon, bMid.lat, bMid.lon)
          const vMid = Math.abs(aMid.altitude - bMid.altitude)
          if (hMid < HORIZ_THRESHOLD_NM && vMid < VERT_THRESHOLD_FT) {
            ttc = mid
            hi = mid
          } else {
            lo = mid
          }
        }

        conflicts.push({
          pair: [a.icao24, b.icao24],
          callsigns: [a.callsign || a.icao24, b.callsign || b.icao24],
          horizontalNm: Math.round(hDist * 100) / 100,
          verticalFt: Math.round(vDist),
          timeToConflict: Math.round(ttc),
          severity: ttc < 30 ? 'ALERT' : 'WARNING',
        })
      }
    }
  }

  return conflicts
}
