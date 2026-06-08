import { Router, type Request, type Response } from 'express'

const router = Router()

let udpPacketCount = 0
let lastResetTime = Date.now()

export function incrementUdpCount() {
  udpPacketCount++
}

export function getUdpPacketRate(): number {
  const elapsed = (Date.now() - lastResetTime) / 1000
  const rate = elapsed > 0 ? udpPacketCount / elapsed : 0
  udpPacketCount = 0
  lastResetTime = Date.now()
  return Math.round(rate * 100) / 100
}

interface RadarConfig {
  rangeNm: 10 | 20 | 40 | 80
  centerLat: number
  centerLon: number
  showLabels: boolean
  showVectors: boolean
  showTrails: boolean
}

const defaultConfig: RadarConfig = {
  rangeNm: 10,
  centerLat: 39.9,
  centerLon: 116.4,
  showLabels: true,
  showVectors: true,
  showTrails: true,
}

let currentConfig = { ...defaultConfig }
let simulatorRunning = false

interface StatusPayload {
  udpPacketRate: number
  trackCount: number
  wsClientCount: number
  simulatorRunning: boolean
}

let statusProvider: (() => StatusPayload) | null = null

export function setStatusProvider(fn: () => StatusPayload) {
  statusProvider = fn
}

export function setSimulatorState(running: boolean) {
  simulatorRunning = running
}

router.get('/status', (_req: Request, res: Response) => {
  if (statusProvider) {
    res.json({ success: true, data: statusProvider() })
  } else {
    res.json({
      success: true,
      data: {
        udpPacketRate: getUdpPacketRate(),
        trackCount: 0,
        wsClientCount: 0,
        simulatorRunning,
      },
    })
  }
})

router.get('/config', (_req: Request, res: Response) => {
  res.json({ success: true, data: currentConfig })
})

router.post('/config', (req: Request, res: Response) => {
  const body = req.body
  if (body.rangeNm) currentConfig.rangeNm = body.rangeNm
  if (body.centerLat !== undefined) currentConfig.centerLat = body.centerLat
  if (body.centerLon !== undefined) currentConfig.centerLon = body.centerLon
  if (body.showLabels !== undefined) currentConfig.showLabels = body.showLabels
  if (body.showVectors !== undefined) currentConfig.showVectors = body.showVectors
  if (body.showTrails !== undefined) currentConfig.showTrails = body.showTrails
  res.json({ success: true, data: currentConfig })
})

router.post('/simulator/toggle', (_req: Request, res: Response) => {
  simulatorRunning = !simulatorRunning
  res.json({ success: true, data: { running: simulatorRunning } })
})

export default router
