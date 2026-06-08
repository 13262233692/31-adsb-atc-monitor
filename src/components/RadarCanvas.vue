<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { wgs84ToScreen } from '@/composables/useProjection'
import type { RadarTrack } from '@/composables/useWebSocket'
import type { ProjectionConfig } from '@/composables/useProjection'

const props = defineProps<{
  tracks: ReadonlyMap<string, RadarTrack>
  rangeNm: 10 | 20 | 40 | 80
  centerLat: number
  centerLon: number
  showLabels: boolean
  showVectors: boolean
  showTrails: boolean
  selectedTrack: string | null
}>()

const emit = defineEmits<{
  'select-track': [icao24: string | null]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let animFrameId = 0
let sweepAngle = 0
let lastTimestamp = 0
let logicalW = 0
let logicalH = 0

const SWEEP_RPM = 6
const SWEEP_SPEED = (SWEEP_RPM * 360) / 60
const AFTERGLOW_DEGREES = 30
const MAX_TRAIL_POINTS = 20
const TRAIL_TTL_MS = 30000
const CACHE_TTL_MS = 30000
const CACHE_EVICTION_MS = 10000
const MAX_CACHE_SIZE = 2000

interface TrailEntry {
  points: { x: number; y: number }[]
  lastUpdate: number
}

interface LabelCacheEntry {
  canvas: OffscreenCanvas
  width: number
  height: number
  cacheKey: string
  lastAccess: number
}

const trailPool = new Map<string, TrailEntry>()
const labelCache = new Map<string, LabelCacheEntry>()
let cacheEvictionTimer: ReturnType<typeof setInterval> | null = null

const getProjectionConfig = (): ProjectionConfig => {
  const size = Math.min(logicalW, logicalH)
  return {
    centerLat: props.centerLat,
    centerLon: props.centerLon,
    rangeNm: props.rangeNm,
    canvasSize: size,
  }
}

function drawBackground() {
  if (!ctx) return
  ctx.fillStyle = '#0A0E14'
  ctx.fillRect(0, 0, logicalW, logicalH)
}

function drawRangeRings(cx: number, cy: number, radius: number) {
  if (!ctx) return
  const ringCount = 4
  const step = radius / ringCount
  ctx.strokeStyle = 'rgba(0, 255, 65, 0.25)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 6])

  for (let i = 1; i <= ringCount; i++) {
    const r = step * i
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.setLineDash([])
  ctx.font = '10px "JetBrains Mono", monospace'
  ctx.fillStyle = 'rgba(0, 255, 65, 0.5)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let i = 1; i <= ringCount; i++) {
    const nm = (props.rangeNm / ringCount) * i
    const r = step * i
    ctx.fillText(`${nm}`, cx + r + 4, cy - 4)
  }
}

function drawAzimuthMarks(cx: number, cy: number, radius: number) {
  if (!ctx) return
  ctx.strokeStyle = 'rgba(0, 255, 65, 0.15)'
  ctx.lineWidth = 1

  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg - 90) * Math.PI / 180
    const innerR = deg % 90 === 0 ? radius - 20 : radius - 10
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(rad) * innerR, cy + Math.sin(rad) * innerR)
    ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius)
    ctx.stroke()
  }

  ctx.font = '11px "Orbitron", monospace'
  ctx.fillStyle = 'rgba(0, 255, 65, 0.6)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const labels = ['N', 'E', 'S', 'W']
  const angles = [-90, 0, 90, 180]
  for (let i = 0; i < 4; i++) {
    const rad = angles[i] * Math.PI / 180
    const labelR = radius + 16
    ctx.fillText(labels[i], cx + Math.cos(rad) * labelR, cy + Math.sin(rad) * labelR)
  }

  for (let deg = 30; deg < 360; deg += 30) {
    if (deg % 90 === 0) continue
    const rad = (deg - 90) * Math.PI / 180
    const labelR = radius + 14
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.fillStyle = 'rgba(0, 255, 65, 0.35)'
    ctx.fillText(`${deg}`, cx + Math.cos(rad) * labelR, cy + Math.sin(rad) * labelR)
  }
}

function drawSweepLine(cx: number, cy: number, radius: number, dt: number) {
  if (!ctx) return
  sweepAngle = (sweepAngle + SWEEP_SPEED * dt) % 360
  const sweepRad = (sweepAngle - 90) * Math.PI / 180

  const afterglowRad = (AFTERGLOW_DEGREES * Math.PI) / 180
  const gradient = ctx.createConicGradient(sweepRad - afterglowRad - Math.PI / 2, cx, cy)
  const endAngle = AFTERGLOW_DEGREES / 360
  gradient.addColorStop(0, 'rgba(0, 255, 65, 0)')
  gradient.addColorStop(endAngle * 0.6, 'rgba(0, 255, 65, 0.08)')
  gradient.addColorStop(endAngle * 0.85, 'rgba(0, 255, 65, 0.2)')
  gradient.addColorStop(endAngle, 'rgba(0, 255, 65, 0.35)')

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, radius, sweepRad - afterglowRad, sweepRad)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = 'rgba(0, 255, 65, 0.7)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(sweepRad) * radius, cy + Math.sin(sweepRad) * radius)
  ctx.stroke()
}

function drawCrossHairs(cx: number, cy: number, radius: number) {
  if (!ctx) return
  ctx.strokeStyle = 'rgba(0, 255, 65, 0.12)'
  ctx.lineWidth = 1
  ctx.setLineDash([2, 8])
  ctx.beginPath()
  ctx.moveTo(cx - radius, cy)
  ctx.lineTo(cx + radius, cy)
  ctx.moveTo(cx, cy - radius)
  ctx.lineTo(cx, cy + radius)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawTrails(cx: number, cy: number) {
  if (!ctx || !props.showTrails) return
  const now = Date.now()
  for (const [icao24, entry] of trailPool) {
    if (now - entry.lastUpdate > TRAIL_TTL_MS) {
      trailPool.delete(icao24)
      continue
    }
    const isSelected = icao24 === props.selectedTrack
    const points = entry.points
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const alpha = ((i + 1) / points.length) * 0.6
      ctx.fillStyle = isSelected
        ? `rgba(0,212,255,${alpha})`
        : `rgba(0,255,65,${alpha})`
      ctx.fillRect(cx + p.x - 1, cy + p.y - 1, 3, 3)
    }
  }
}

function buildLabelCacheKey(track: RadarTrack, isSelected: boolean): string {
  return `${track.icao24}|${track.callsign}|${Math.round(track.altitude / 100)}|${Math.round(track.groundSpeed)}|${isSelected ? 1 : 0}`
}

function getOrCreateLabelCache(track: RadarTrack, isSelected: boolean): LabelCacheEntry | null {
  const cacheKey = buildLabelCacheKey(track, isSelected)
  const cached = labelCache.get(cacheKey)
  if (cached) {
    cached.lastAccess = Date.now()
    return cached
  }

  const line1 = track.callsign || track.icao24
  const fl = Math.round(track.altitude / 100)
  const line2 = `FL${fl} ${Math.round(track.groundSpeed)}kt`

  const tempCanvas = new OffscreenCanvas(200, 30)
  const tctx = tempCanvas.getContext('2d')
  if (!tctx) return null

  tctx.font = 'bold 11px "JetBrains Mono", monospace'
  const w1 = tctx.measureText(line1).width
  tctx.font = '9px "JetBrains Mono", monospace'
  const w2 = tctx.measureText(line2).width
  const boxW = Math.max(w1, w2) + 10
  const boxH = 30

  const oc = new OffscreenCanvas(boxW, boxH)
  const octx = oc.getContext('2d')
  if (!octx) return null

  octx.fillStyle = 'rgba(10, 14, 20, 0.75)'
  octx.fillRect(0, 0, boxW, boxH)

  const textColor = isSelected ? '#00D4FF' : '#ffffff'
  const dimColor = isSelected ? 'rgba(0, 212, 255, 0.7)' : 'rgba(200, 220, 200, 0.7)'

  octx.font = 'bold 11px "JetBrains Mono", monospace'
  octx.fillStyle = textColor
  octx.textAlign = 'left'
  octx.textBaseline = 'top'
  octx.fillText(line1, 4, 3)

  octx.font = '9px "JetBrains Mono", monospace'
  octx.fillStyle = dimColor
  octx.fillText(line2, 4, 16)

  const entry: LabelCacheEntry = {
    canvas: oc,
    width: boxW,
    height: boxH,
    cacheKey,
    lastAccess: Date.now(),
  }
  labelCache.set(cacheKey, entry)
  return entry
}

function evictLabelCache() {
  const now = Date.now()
  for (const [key, entry] of labelCache) {
    if (now - entry.lastAccess > CACHE_TTL_MS) {
      labelCache.delete(key)
    }
  }
  if (labelCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(labelCache.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const overflow = labelCache.size - Math.floor(MAX_CACHE_SIZE * 0.7)
    for (let i = 0; i < overflow && i < entries.length; i++) {
      labelCache.delete(entries[i][0])
    }
  }
}

function drawAircraft(cx: number, cy: number, track: RadarTrack, relX: number, relY: number, isSelected: boolean) {
  if (!ctx) return
  const x = cx + relX
  const y = cy + relY
  const headingRad = track.track * Math.PI / 180
  const size = 8

  const color = isSelected ? '#00D4FF' : '#00FF41'

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(headingRad)

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(size, 0)
  ctx.lineTo(-size * 0.6, -size * 0.5)
  ctx.lineTo(-size * 0.3, 0)
  ctx.lineTo(-size * 0.6, size * 0.5)
  ctx.closePath()
  ctx.fill()

  ctx.restore()

  if (props.showVectors) {
    drawVelocityVector(x, y, track, color)
  }

  if (props.showLabels) {
    drawDataLabelCached(x, y, track, isSelected)
  }

  if (isSelected) {
    drawPulseRing(x, y)
  }
}

function drawVelocityVector(x: number, y: number, track: RadarTrack, color: string) {
  if (!ctx) return
  const headingRad = track.track * Math.PI / 180
  const nmPerMinute = track.groundSpeed / 60
  const pixelsPerNm = getProjectionConfig().canvasSize / (2 * props.rangeNm)
  const lineLength = nmPerMinute * 2 * pixelsPerNm

  const endX = x + Math.cos(headingRad) * lineLength
  const endY = y + Math.sin(headingRad) * lineLength

  ctx.strokeStyle = color
  ctx.globalAlpha = 0.6
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(endX, endY)
  ctx.stroke()
  ctx.globalAlpha = 1
}

function drawDataLabelCached(x: number, y: number, track: RadarTrack, isSelected: boolean) {
  if (!ctx) return
  const cached = getOrCreateLabelCache(track, isSelected)
  if (!cached) return
  const lx = x + 14
  const ly = y - 10
  ctx.drawImage(cached.canvas, lx - 2, ly - 2, cached.width, cached.height)
}

function drawPulseRing(x: number, y: number) {
  if (!ctx) return
  const t = performance.now() / 1000
  const pulse = 12 + Math.sin(t * 4) * 4
  const alpha = 0.4 + Math.sin(t * 4) * 0.2

  ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, pulse, 0, Math.PI * 2)
  ctx.stroke()
}

let vignetteGradient: CanvasGradient | null = null
let vignetteW = 0
let vignetteH = 0

function drawVignette() {
  if (!ctx) return
  if (!vignetteGradient || vignetteW !== logicalW || vignetteH !== logicalH) {
    vignetteGradient = ctx.createRadialGradient(
      logicalW / 2, logicalH / 2, Math.min(logicalW, logicalH) * 0.25,
      logicalW / 2, logicalH / 2, Math.min(logicalW, logicalH) * 0.55
    )
    vignetteGradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    vignetteGradient.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
    vignetteW = logicalW
    vignetteH = logicalH
  }
  ctx.fillStyle = vignetteGradient
  ctx.fillRect(0, 0, logicalW, logicalH)
}

function drawScanLines() {
  if (!ctx) return
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
  for (let y = 0; y < logicalH; y += 3) {
    ctx.fillRect(0, y, logicalW, 1)
  }
}

function updateTrails() {
  const now = Date.now()
  const config = getProjectionConfig()
  const halfSize = config.canvasSize / 2

  const activeKeys = new Set<string>()

  for (const [icao24, track] of props.tracks) {
    activeKeys.add(icao24)
    let entry = trailPool.get(icao24)
    if (!entry) {
      entry = { points: [], lastUpdate: now }
      trailPool.set(icao24, entry)
    }
    entry.lastUpdate = now
    const pos = wgs84ToScreen(track.lat, track.lon, config)
    entry.points.push({ x: pos.x - halfSize, y: pos.y - halfSize })
    if (entry.points.length > MAX_TRAIL_POINTS) {
      entry.points.shift()
    }
  }

  for (const [key, entry] of trailPool) {
    if (!activeKeys.has(key) && now - entry.lastUpdate > TRAIL_TTL_MS) {
      trailPool.delete(key)
    }
  }
}

function hitTest(mouseX: number, mouseY: number): string | null {
  const cx = logicalW / 2
  const cy = logicalH / 2
  const config = getProjectionConfig()
  const halfSize = config.canvasSize / 2
  const hitRadius = 16

  for (const [icao24, track] of props.tracks) {
    const pos = wgs84ToScreen(track.lat, track.lon, config)
    const sx = cx + pos.x - halfSize
    const sy = cy + pos.y - halfSize
    const dx = mouseX - sx
    const dy = mouseY - sy
    if (dx * dx + dy * dy < hitRadius * hitRadius) {
      return icao24
    }
  }
  return null
}

function render(timestamp: number) {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return

  const dt = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0.016
  lastTimestamp = timestamp

  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const cx = logicalW / 2
  const cy = logicalH / 2
  const radius = Math.min(cx, cy) - 24

  drawBackground()
  drawCrossHairs(cx, cy, radius)
  drawRangeRings(cx, cy, radius)
  drawAzimuthMarks(cx, cy, radius)
  drawSweepLine(cx, cy, radius, dt)
  updateTrails()
  drawTrails(cx, cy)

  const config = getProjectionConfig()
  const halfSize = config.canvasSize / 2
  const r2 = (radius + 20) * (radius + 20)
  for (const [icao24, track] of props.tracks) {
    const pos = wgs84ToScreen(track.lat, track.lon, config)
    const relX = pos.x - halfSize
    const relY = pos.y - halfSize
    if (relX * relX + relY * relY <= r2) {
      drawAircraft(cx, cy, track, relX, relY, icao24 === props.selectedTrack)
    }
  }

  drawVignette()
  drawScanLines()

  animFrameId = requestAnimationFrame(render)
}

function handleResize() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return
  const dpr = window.devicePixelRatio || 1
  const rect = container.getBoundingClientRect()
  logicalW = rect.width
  logicalH = rect.height
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`
  vignetteGradient = null
}

function handleClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  const hit = hitTest(mouseX, mouseY)
  emit('select-track', hit)
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  ctx = canvas.getContext('2d')
  handleResize()
  animFrameId = requestAnimationFrame(render)

  resizeObserver = new ResizeObserver(() => {
    handleResize()
  })
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }

  cacheEvictionTimer = setInterval(evictLabelCache, CACHE_EVICTION_MS)
})

onBeforeUnmount(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (resizeObserver) resizeObserver.disconnect()
  if (cacheEvictionTimer) {
    clearInterval(cacheEvictionTimer)
    cacheEvictionTimer = null
  }
  trailPool.clear()
  labelCache.clear()
  vignetteGradient = null
  ctx = null
})

watch([() => props.rangeNm, () => props.centerLat, () => props.centerLon], () => {
  trailPool.clear()
  labelCache.clear()
})
</script>

<template>
  <div ref="containerRef" class="w-full h-full relative">
    <canvas
      ref="canvasRef"
      class="absolute inset-0 cursor-crosshair"
      @click="handleClick"
    />
  </div>
</template>
