import { ref, readonly } from 'vue'

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

interface RadarUpdate {
  type: 'track_update'
  tracks: RadarTrack[]
  timestamp: number
}

export function useWebSocket() {
  const tracks = ref<Map<string, RadarTrack>>(new Map())
  const connected = ref(false)
  const connecting = ref(false)

  let ws: WebSocket | null = null
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false

  const getWsUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.hostname}:3001`
  }

  const getMaxDelay = () => Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)

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
    }

    ws.onmessage = (event) => {
      try {
        const data: RadarUpdate = JSON.parse(event.data)
        if (data.type === 'track_update' && Array.isArray(data.tracks)) {
          const newMap = new Map(tracks.value)
          for (const track of data.tracks) {
            newMap.set(track.icao24, track)
          }
          tracks.value = newMap
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      connected.value = false
      connecting.value = false
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
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
    connected.value = false
    connecting.value = false
  }

  return {
    tracks: readonly(tracks),
    connected: readonly(connected),
    connecting: readonly(connecting),
    connect,
    disconnect,
  }
}
