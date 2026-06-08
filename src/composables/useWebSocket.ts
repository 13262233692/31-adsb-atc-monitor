import { ref, readonly, onScopeDispose } from 'vue'

export interface RadarTrack {
  icao24: string
  callsign: string
  lat: number
  lon: number
  altitude: number
  groundSpeed: number
  track: number
  verticalRate: number
  timestamp: number
}

export interface ConflictAlert {
  pair: [string, string]
  callsigns: [string, string]
  horizontalNm: number
  verticalFt: number
  timeToConflict: number
  severity: 'WARNING' | 'ALERT'
}

interface RadarUpdate {
  type: 'track_update'
  tracks: RadarTrack[]
  conflicts: ConflictAlert[]
  timestamp: number
}

const TRACK_TTL_MS = 30000
const EVICTION_INTERVAL_MS = 5000
const MAX_TRACK_COUNT = 10000

export function useWebSocket() {
  const tracks = ref<Map<string, RadarTrack>>(new Map())
  const conflicts = ref<ConflictAlert[]>([])
  const connected = ref(false)
  const connecting = ref(false)

  let ws: WebSocket | null = null
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let evictionTimer: ReturnType<typeof setInterval> | null = null
  let intentionalClose = false

  const getWsUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.hostname}:3001`
  }

  const getMaxDelay = () => Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)

  function evictStaleTracks() {
    const now = Date.now()
    const current = tracks.value
    let evicted = 0
    for (const [key, track] of current) {
      if (now - track.timestamp > TRACK_TTL_MS) {
        current.delete(key)
        evicted++
      }
    }
    if (evicted > 0) {
      tracks.value = new Map(current)
    }
  }

  function startEvictionTimer() {
    if (evictionTimer) return
    evictionTimer = setInterval(evictStaleTracks, EVICTION_INTERVAL_MS)
  }

  function stopEvictionTimer() {
    if (evictionTimer) {
      clearInterval(evictionTimer)
      evictionTimer = null
    }
  }

  const connect = () => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

    intentionalClose = false
    connecting.value = true
    const url = getWsUrl()
    ws = new WebSocket(url)

    ws.onopen = () => {
      connected.value = true
      connecting.value = false
      reconnectAttempts = 0
      startEvictionTimer()
    }

    ws.onmessage = (event) => {
      try {
        const data: RadarUpdate = JSON.parse(event.data)
        if (data.type === 'track_update' && Array.isArray(data.tracks)) {
          const map = tracks.value
          for (const track of data.tracks) {
            map.set(track.icao24, track)
          }
          if (map.size > MAX_TRACK_COUNT) {
            const now = Date.now()
            const entries = Array.from(map.entries())
              .sort((a, b) => b[1].timestamp - a[1].timestamp)
            const overflow = map.size - MAX_TRACK_COUNT
            for (let i = entries.length - overflow; i < entries.length; i++) {
              const [key, t] = entries[i]
              if (now - t.timestamp > TRACK_TTL_MS / 2) {
                map.delete(key)
              }
            }
          }
          tracks.value = new Map(map)

          if (Array.isArray(data.conflicts)) {
            conflicts.value = data.conflicts
          } else {
            conflicts.value = []
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      connected.value = false
      connecting.value = false
      stopEvictionTimer()
      if (!intentionalClose) {
        const delay = getMaxDelay()
        reconnectAttempts++
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  const disconnect = () => {
    intentionalClose = true
    stopEvictionTimer()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
    connected.value = false
    connecting.value = false
    conflicts.value = []
  }

  onScopeDispose(() => {
    disconnect()
  })

  return {
    tracks: readonly(tracks),
    conflicts: readonly(conflicts),
    connected: readonly(connected),
    connecting: readonly(connecting),
    connect,
    disconnect,
  }
}
