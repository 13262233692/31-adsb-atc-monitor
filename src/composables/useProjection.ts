export interface ProjectionConfig {
  centerLat: number
  centerLon: number
  rangeNm: number
  canvasSize: number
}

export function wgs84ToScreen(lat: number, lon: number, config: ProjectionConfig): { x: number; y: number } {
  const nmPerDegLat = 60
  const nmPerDegLon = 60 * Math.cos(config.centerLat * Math.PI / 180)
  const pixelsPerNm = config.canvasSize / (2 * config.rangeNm)
  const x = (lon - config.centerLon) * nmPerDegLon * pixelsPerNm + config.canvasSize / 2
  const y = -(lat - config.centerLat) * nmPerDegLat * pixelsPerNm + config.canvasSize / 2
  return { x, y }
}

export function screenToWgs84(x: number, y: number, config: ProjectionConfig): { lat: number; lon: number } {
  const nmPerDegLat = 60
  const nmPerDegLon = 60 * Math.cos(config.centerLat * Math.PI / 180)
  const pixelsPerNm = config.canvasSize / (2 * config.rangeNm)
  const lon = (x - config.canvasSize / 2) / (nmPerDegLon * pixelsPerNm) + config.centerLon
  const lat = -(y - config.canvasSize / 2) / (nmPerDegLat * pixelsPerNm) + config.centerLat
  return { lat, lon }
}
