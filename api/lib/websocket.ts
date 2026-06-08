import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { RadarTrack } from './asterix.js'
import type { ConflictAlert } from './stca.js'

interface RadarUpdate {
  type: 'track_update'
  tracks: RadarTrack[]
  conflicts: ConflictAlert[]
  timestamp: number
}

export function createWSBroadcaster(server: Server) {
  const wss = new WebSocketServer({ server, path: '/' })
  const trackStore = new Map<string, RadarTrack>()
  let lastConflicts: ConflictAlert[] = []
  let broadcastTimer: ReturnType<typeof setInterval> | null = null

  wss.on('connection', (ws: WebSocket) => {
    console.log(`[WS] Client connected. Total: ${wss.clients.size}`)
    if (trackStore.size > 0) {
      const update: RadarUpdate = {
        type: 'track_update',
        tracks: Array.from(trackStore.values()),
        conflicts: lastConflicts,
        timestamp: Date.now(),
      }
      ws.send(JSON.stringify(update))
    }

    ws.on('close', () => {
      console.log(`[WS] Client disconnected. Total: ${wss.clients.size}`)
    })

    ws.on('error', () => {})
  })

  function updateTracks(tracks: RadarTrack[]) {
    for (const track of tracks) {
      trackStore.set(track.icao24, track)
    }

    const now = Date.now()
    const staleThreshold = 30000
    for (const [key, track] of trackStore) {
      if (now - track.timestamp > staleThreshold) {
        trackStore.delete(key)
      }
    }
  }

  function updateConflicts(conflicts: ConflictAlert[]) {
    lastConflicts = conflicts
  }

  function broadcastNow() {
    if (wss.clients.size === 0) return
    const update: RadarUpdate = {
      type: 'track_update',
      tracks: Array.from(trackStore.values()),
      conflicts: lastConflicts,
      timestamp: Date.now(),
    }
    const data = JSON.stringify(update)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  function startBroadcasting(intervalMs = 1000) {
    if (broadcastTimer) clearInterval(broadcastTimer)
    broadcastTimer = setInterval(broadcastNow, intervalMs)
  }

  function stopBroadcasting() {
    if (broadcastTimer) {
      clearInterval(broadcastTimer)
      broadcastTimer = null
    }
  }

  function getTrackCount(): number {
    return trackStore.size
  }

  function getClientCount(): number {
    return wss.clients.size
  }

  function getConflictCount(): number {
    return lastConflicts.length
  }

  startBroadcasting(1000)

  return {
    updateTracks,
    updateConflicts,
    broadcastNow,
    startBroadcasting,
    stopBroadcasting,
    getTrackCount,
    getClientCount,
    getConflictCount,
    close: () => {
      stopBroadcasting()
      wss.close()
    },
  }
}
