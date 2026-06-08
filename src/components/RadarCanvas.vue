<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
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
const trailHistory = new Map<string, { x: number; y: number }[]>()
const SWEEP_RPM = 6
const SWEEP_SPEED = (SWEEP_RPM * 360) / 60
const AFTERGLOW_DEGREES = 30
const MAX_TRAIL_POINTS = 20

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
  for (const [icao24, points] of trailHistory) {
    const isSelected = icao24 === props.selectedTrack
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const alpha = ((i + 1) / points.length) * 0.6
      const color = isSelected ? `rgba(0, 212, 255, ${alpha})` : `rgba(0, 255, 65, ${alpha})`
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(cx + p.x, cy + p.y, 1.5, 0, Math.PI * 2)
      ctx.fill()
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
    drawDataLabel(x, y, track, isSelected)
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

  const gradient = ctx.createLinearGradient(x, y, endX, endY)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(0, 255, 65, 0)')

  ctx.strokeStyle = gradient
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(endX, endY)
  ctx.stroke()
}

function drawDataLabel(x: number, y: number, track: RadarTrack, isSelected: boolean) {
  if (!ctx) return
  const offsetX = 14
  const offsetY = -10
  const lx = x + offsetX
  const ly = y + offsetY

  const line1 = track.callsign || track.icao24
  const fl = Math.round(track.altitude / 100)
  const line2 = `FL${fl} ${Math.round(track.groundSpeed)}kt`

  ctx.font = 'bold 11px "JetBrains Mono", monospace'
  const w1 = ctx.measureText(line1).width
  ctx.font = '9px "JetBrains Mono", monospace'
  const w2 = ctx.measureText(line2).width
  const boxW = Math.max(w1, w2) + 8
  const boxH = 28

  ctx.fillStyle = 'rgba(10, 14, 20, 0.75)'
  ctx.fillRect(lx - 2, ly - 2, boxW, boxH)

  const textColor = isSelected ? '#00D4FF' : '#ffffff'
  const dimColor = isSelected ? 'rgba(0, 212, 255, 0.7)' : 'rgba(200, 220, 200, 0.7)'

  ctx.font = 'bold 11px "JetBrains Mono", monospace'
  ctx.fillStyle = textColor
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(line1, lx + 2, ly + 2)

  ctx.font = '9px "JetBrains Mono", monospace'
  ctx.fillStyle = dimColor
  ctx.fillText(line2, lx + 2, ly + 15)
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

function drawVignette() {
  if (!ctx) return
  const gradient = ctx.createRadialGradient(logicalW / 2, logicalH / 2, Math.min(logicalW, logicalH) * 0.25, logicalW / 2, logicalH / 2, Math.min(logicalW, logicalH) * 0.55)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
  ctx.fillStyle = gradient
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
  const config = getProjectionConfig()
  const halfSize = config.canvasSize / 2
  for (const [icao24, track] of props.tracks) {
    if (!trailHistory.has(icao24)) {
      trailHistory.set(icao24, [])
    }
    const points = trailHistory.get(icao24)!
    const pos = wgs84ToScreen(track.lat, track.lon, config)
    points.push({ x: pos.x - halfSize, y: pos.y - halfSize })
    if (points.length > MAX_TRAIL_POINTS) {
      points.shift()
    }
  }
  const currentKeys = new Set(props.tracks.keys())
  for (const key of trailHistory.keys()) {
    if (!currentKeys.has(key)) {
      trailHistory.delete(key)
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
  for (const [icao24, track] of props.tracks) {
    const pos = wgs84ToScreen(track.lat, track.lon, config)
    const relX = pos.x - halfSize
    const relY = pos.y - halfSize
    const distFromCenter = Math.sqrt(relX * relX + relY * relY)
    if (distFromCenter <= radius + 20) {
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
})

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (resizeObserver) resizeObserver.disconnect()
})

watch([() => props.rangeNm, () => props.centerLat, () => props.centerLon], () => {
  trailHistory.clear()
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
