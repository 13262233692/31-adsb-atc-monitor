import dgram from 'dgram'
import { parseAsterixCat021 } from './asterix.js'
import type { RadarTrack } from './asterix.js'

interface SimFlight {
  icao24: string
  callsign: string
  lat: number
  lon: number
  altitude: number
  groundSpeed: number
  track: number
  verticalRate: number
}

const AIRLINES = [
  { prefix: 'CCA', hex: ['780' ] },
  { prefix: 'CSN', hex: ['7800', '7810'] },
  { prefix: 'MU', hex: ['7812', '7814'] },
  { prefix: 'CZH', hex: ['7816'] },
  { prefix: 'HXA', hex: ['7818'] },
  { prefix: 'CSC', hex: ['781A'] },
  { prefix: 'CCA', hex: ['7820'] },
  { prefix: 'BCA', hex: ['7822'] },
  { prefix: 'DKH', hex: ['7824'] },
  { prefix: 'CGW', hex: ['7826'] },
  { prefix: 'JSA', hex: ['7828'] },
  { prefix: 'TBA', hex: ['782A'] },
  { prefix: 'YZR', hex: ['782C'] },
  { prefix: 'GCR', hex: ['782E'] },
  { prefix: 'CSZ', hex: ['7830'] },
  { prefix: 'CDG', hex: ['7832'] },
  { prefix: 'CHB', hex: ['7834'] },
  { prefix: 'OKA', hex: ['7836'] },
  { prefix: 'FAX', hex: ['7838'] },
  { prefix: 'JAE', hex: ['783A'] },
]

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function buildCat021Buffer(flight: SimFlight): Buffer {
  const parts: Buffer[] = []

  const cat = Buffer.alloc(1)
  cat.writeUInt8(0x15, 0)

  const fspec = Buffer.alloc(2)
  fspec.writeUInt8(0b11111010, 0)
  fspec.writeUInt8(0b11111100, 1)

  const dataParts: Buffer[] = []

  const dsId = Buffer.alloc(2)
  dsId.writeUInt8(0x01, 0)
  dsId.writeUInt8(0x02, 1)
  dataParts.push(dsId)

  const trd = Buffer.alloc(1)
  trd.writeUInt8(0x01, 0)
  dataParts.push(trd)

  const tn = Buffer.alloc(2)
  tn.writeUInt16BE(randInt(1, 4095), 0)
  dataParts.push(tn)

  const si = Buffer.alloc(1)
  si.writeUInt8(0x01, 0)
  dataParts.push(si)

  const todMs = Date.now() % 86400000
  const tod128 = Math.floor(todMs * 128 / 1000)
  const tod = Buffer.alloc(3)
  tod.writeUInt8((tod128 >> 16) & 0xFF, 0)
  tod.writeUInt8((tod128 >> 8) & 0xFF, 1)
  tod.writeUInt8(tod128 & 0xFF, 2)
  dataParts.push(tod)

  const latVal = Math.round(flight.lat * 10000)
  const lonVal = Math.round(flight.lon * 10000)
  const pos = Buffer.alloc(6)
  pos.writeInt8((latVal >> 16) & 0xFF, 0)
  pos.writeUInt8((latVal >> 8) & 0xFF, 1)
  pos.writeUInt8(latVal & 0xFF, 2)
  pos.writeInt8((lonVal >> 16) & 0xFF, 3)
  pos.writeUInt8((lonVal >> 8) & 0xFF, 4)
  pos.writeUInt8(lonVal & 0xFF, 5)

  const latInt24 = Math.max(-8388608, Math.min(8388607, Math.round(flight.lat * 10000)))
  const lonInt24 = Math.max(-8388608, Math.min(8388607, Math.round(flight.lon * 10000)))
  const posBuf = Buffer.alloc(6)
  posBuf.writeInt8((latInt24 >> 16) & 0xFF, 0)
  posBuf.writeUInt8((latInt24 >> 8) & 0xFF, 1)
  posBuf.writeUInt8(latInt24 & 0xFF, 2)
  posBuf.writeInt8((lonInt24 >> 16) & 0xFF, 3)
  posBuf.writeUInt8((lonInt24 >> 8) & 0xFF, 4)
  posBuf.writeUInt8(lonInt24 & 0xFF, 5)
  dataParts.push(posBuf)

  const fl = Math.round(flight.altitude / 100 / 0.25)
  const flBuf = Buffer.alloc(2)
  flBuf.writeUInt16BE(Math.max(0, fl), 0)
  dataParts.push(flBuf)

  const mops = Buffer.alloc(1)
  mops.writeUInt8(0x01, 0)
  dataParts.push(mops)

  const m3a = Buffer.alloc(2)
  m3a.writeUInt16BE(randInt(0, 4095), 0)
  dataParts.push(m3a)

  const icaoBytes = Buffer.from(flight.icao24, 'hex')
  dataParts.push(icaoBytes.length === 3 ? icaoBytes : Buffer.alloc(3, 0))

  const csBuf = Buffer.alloc(6, 0)
  const cs = flight.callsign.padEnd(8, ' ').slice(0, 8)
  let bitPos = 0
  for (let ci = 0; ci < 8 && ci < cs.length; ci++) {
    let val = 0
    const ch = cs.charCodeAt(ci)
    if (ch >= 65 && ch <= 90) val = ch - 64
    else if (ch >= 48 && ch <= 57) val = ch
    else val = 32
    for (let b = 5; b >= 0; b--) {
      const byteIdx = Math.floor(bitPos / 8)
      const bitIdx = 7 - (bitPos % 8)
      if ((val >> b) & 1) {
        csBuf[byteIdx] |= (1 << bitIdx)
      }
      bitPos++
    }
  }
  dataParts.push(csBuf)

  const spdVal = Math.round(flight.groundSpeed / 0.25)
  const trkVal = Math.round(flight.track / 0.0055)
  const velBuf = Buffer.alloc(4)
  velBuf.writeUInt16BE(Math.max(0, spdVal), 0)
  velBuf.writeUInt16BE(Math.max(0, trkVal), 2)
  dataParts.push(velBuf)

  const vrVal = Math.round(flight.verticalRate / 6.25)
  const vrBuf = Buffer.alloc(2)
  vrBuf.writeInt16BE(Math.max(-32768, Math.min(32767, vrVal)), 0)
  dataParts.push(vrBuf)

  const bodyData = Buffer.concat([fspec, ...dataParts])
  const len = 1 + 2 + bodyData.length
  const lenBuf = Buffer.alloc(2)
  lenBuf.writeUInt16BE(len, 0)

  return Buffer.concat([cat, lenBuf, bodyData])
}

export function createSimulator(config?: {
  udpPort?: number
  centerLat?: number
  centerLon?: number
  flightCount?: number
}) {
  const udpPort = config?.udpPort ?? 5000
  const centerLat = config?.centerLat ?? 39.9
  const centerLon = config?.centerLon ?? 116.4
  const flightCount = config?.flightCount ?? 20

  let flights: SimFlight[] = []
  let running = false
  let intervalId: ReturnType<typeof setInterval> | null = null
  let udpSender: dgram.Socket | null = null

  function initFlights() {
    flights = []
    for (let i = 0; i < flightCount; i++) {
      const airline = AIRLINES[i % AIRLINES.length]
      const hexBase = airline.hex[0] || '7800'
      const hexSuffix = (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase().slice(0, 2)
      flights.push({
        icao24: hexBase.slice(0, 4) + hexSuffix,
        callsign: airline.prefix + String(randInt(1000, 9999)),
        lat: centerLat + randFloat(-0.5, 0.5),
        lon: centerLon + randFloat(-0.5, 0.5),
        altitude: randInt(100, 400) * 100,
        groundSpeed: randFloat(200, 500),
        track: randFloat(0, 360),
        verticalRate: randFloat(-1500, 1500),
      })
    }
  }

  function updateFlights() {
    for (const f of flights) {
      const trackRad = f.track * Math.PI / 180
      const nmPerSec = f.groundSpeed / 3600
      const latSpeed = nmPerSec * Math.cos(trackRad) / 60
      const lonSpeed = nmPerSec * Math.sin(trackRad) / (60 * Math.cos(f.lat * Math.PI / 180))
      f.lat += latSpeed
      f.lon += lonSpeed

      f.altitude += f.verticalRate / 60
      if (f.altitude < 1000) { f.altitude = 1000; f.verticalRate = Math.abs(f.verticalRate) }
      if (f.altitude > 45000) { f.altitude = 45000; f.verticalRate = -Math.abs(f.verticalRate) }

      if (Math.random() < 0.02) {
        f.track += randFloat(-15, 15)
        f.track = (f.track + 360) % 360
      }
      if (Math.random() < 0.01) {
        f.verticalRate = randFloat(-1500, 1500)
      }
    }
  }

  function sendPackets() {
    if (!udpSender) return
    updateFlights()

    for (const flight of flights) {
      const buf = buildCat021Buffer(flight)
      udpSender.send(buf, udpPort, '127.0.0.1')
    }
  }

  function start() {
    if (running) return
    running = true
    initFlights()
    udpSender = dgram.createSocket('udp4')
    intervalId = setInterval(sendPackets, 1000)
    console.log(`[Simulator] Started with ${flightCount} flights, sending to UDP port ${udpPort}`)
  }

  function stop() {
    if (!running) return
    running = false
    if (intervalId) { clearInterval(intervalId); intervalId = null }
    if (udpSender) { udpSender.close(); udpSender = null }
    console.log('[Simulator] Stopped')
  }

  return { start, stop, isRunning: () => running, getFlightCount: () => flights.length }
}

export function generateDirectTracks(
  centerLat = 39.9,
  centerLon = 116.4,
  count = 20
): RadarTrack[] {
  const tracks: RadarTrack[] = []
  for (let i = 0; i < count; i++) {
    const airline = AIRLINES[i % AIRLINES.length]
    const hexBase = airline.hex[0] || '7800'
    const hexSuffix = ((i * 7 + 3) % 256).toString(16).padStart(2, '0').toUpperCase()
    tracks.push({
      icao24: hexBase.slice(0, 4) + hexSuffix,
      callsign: airline.prefix + String(randInt(1000, 9999)),
      lat: centerLat + randFloat(-0.5, 0.5),
      lon: centerLon + randFloat(-0.5, 0.5),
      altitude: randInt(100, 400) * 100,
      groundSpeed: randFloat(200, 500),
      track: randFloat(0, 360),
      verticalRate: randFloat(-1500, 1500),
      timestamp: Date.now(),
    })
  }
  return tracks
}
