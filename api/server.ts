import dgram from 'dgram'
import { createServer } from 'http'
import app from './app.js'
import { parseAsterixCat021 } from './lib/asterix.js'
import { createWSBroadcaster } from './lib/websocket.js'
import { createSimulator, generateDirectTracks } from './lib/simulator.js'
import { detectConflicts } from './lib/stca.js'
import { incrementUdpCount, setStatusProvider, setSimulatorState } from './routes/radar.js'

const PORT = process.env.PORT || 3001
const UDP_PORT = parseInt(process.env.UDP_PORT || '5000', 10)

const server = createServer(app)

const broadcaster = createWSBroadcaster(server)

const udpServer = dgram.createSocket('udp4')

udpServer.on('message', (msg: Buffer) => {
  try {
    incrementUdpCount()
    const tracks = parseAsterixCat021(msg)
    if (tracks.length > 0) {
      broadcaster.updateTracks(tracks)
    }
  } catch (e) {
    // ignore parse errors
  }
})

udpServer.on('error', (err) => {
  console.error('[UDP] Server error:', err)
})

udpServer.bind(UDP_PORT, () => {
  console.log(`[UDP] Listening on port ${UDP_PORT}`)
})

const simulator = createSimulator({
  udpPort: UDP_PORT,
  centerLat: 39.9,
  centerLon: 116.4,
  flightCount: 20,
})

console.log('[Simulator] Auto-starting with direct mode (no UDP loopback)')

const SEED_FLIGHTS = generateDirectTracks(39.9, 116.4, 20)
const trackPositions = new Map<string, { lat: number; lon: number; altitude: number; track: number; groundSpeed: number; verticalRate: number }>()

for (const t of SEED_FLIGHTS) {
  trackPositions.set(t.icao24, {
    lat: t.lat,
    lon: t.lon,
    altitude: t.altitude,
    track: t.track,
    groundSpeed: t.groundSpeed,
    verticalRate: t.verticalRate,
  })
  broadcaster.updateTracks([t])
}

let stcaLogThrottle = 0

const simInterval = setInterval(() => {
  const updatedTracks = []
  for (const [icao24, pos] of trackPositions) {
    const trackRad = pos.track * Math.PI / 180
    const nmPerSec = pos.groundSpeed / 3600
    const latSpeed = nmPerSec * Math.cos(trackRad) / 60
    const lonSpeed = nmPerSec * Math.sin(trackRad) / (60 * Math.cos(pos.lat * Math.PI / 180))
    pos.lat += latSpeed
    pos.lon += lonSpeed
    pos.altitude += pos.verticalRate / 60
    if (pos.altitude < 1000) { pos.altitude = 1000; pos.verticalRate = Math.abs(pos.verticalRate) }
    if (pos.altitude > 45000) { pos.altitude = 45000; pos.verticalRate = -Math.abs(pos.verticalRate) }
    if (Math.random() < 0.02) {
      pos.track += (Math.random() - 0.5) * 30
      pos.track = (pos.track + 360) % 360
    }
    if (Math.random() < 0.01) {
      pos.verticalRate = (Math.random() - 0.5) * 3000
    }

    const seedTrack = SEED_FLIGHTS.find(t => t.icao24 === icao24)
    updatedTracks.push({
      icao24,
      callsign: seedTrack?.callsign || 'N/A',
      lat: pos.lat,
      lon: pos.lon,
      altitude: pos.altitude,
      groundSpeed: pos.groundSpeed,
      track: pos.track,
      verticalRate: pos.verticalRate,
      timestamp: Date.now(),
    })
  }
  broadcaster.updateTracks(updatedTracks)

  const allTracks = new Map(updatedTracks.map(t => [t.icao24, t]))
  const conflicts = detectConflicts(allTracks)
  broadcaster.updateConflicts(conflicts)

  if (conflicts.length > 0) {
    stcaLogThrottle++
    if (stcaLogThrottle % 5 === 1) {
      for (const c of conflicts) {
        console.log(`[STCA] ${c.severity} ${c.callsigns[0]} <-> ${c.callsigns[1]} | H:${c.horizontalNm}NM V:${c.verticalFt}ft TTC:${c.timeToConflict}s`)
      }
    }
  } else {
    stcaLogThrottle = 0
  }
}, 1000)

setStatusProvider(() => ({
  udpPacketRate: 0,
  trackCount: broadcaster.getTrackCount(),
  wsClientCount: broadcaster.getClientCount(),
  conflictCount: broadcaster.getConflictCount(),
  simulatorRunning: true,
}))

setSimulatorState(true)

server.listen(PORT, () => {
  console.log(`[HTTP] Server ready on port ${PORT}`)
  console.log(`[WS] WebSocket available on ws://localhost:${PORT}`)
  console.log(`[STCA] Conflict detection engine active (5NM / 1000ft / 120s)`)
})

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received')
  clearInterval(simInterval)
  simulator.stop()
  broadcaster.close()
  udpServer.close()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received')
  clearInterval(simInterval)
  simulator.stop()
  broadcaster.close()
  udpServer.close()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

export default app
