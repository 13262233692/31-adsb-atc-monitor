import { reactive, computed } from 'vue'

interface RadarState {
  rangeNm: 10 | 20 | 40 | 80
  centerLat: number
  centerLon: number
  showLabels: boolean
  showVectors: boolean
  showTrails: boolean
  selectedTrack: string | null
  simulatorRunning: boolean
}

const state = reactive<RadarState>({
  rangeNm: 10,
  centerLat: 39.9,
  centerLon: 116.4,
  showLabels: true,
  showVectors: true,
  showTrails: true,
  selectedTrack: null,
  simulatorRunning: false,
})

export function useRadarStore() {
  const setRange = (range: 10 | 20 | 40 | 80) => {
    state.rangeNm = range
  }

  const toggleLabels = () => {
    state.showLabels = !state.showLabels
  }

  const toggleVectors = () => {
    state.showVectors = !state.showVectors
  }

  const toggleTrails = () => {
    state.showTrails = !state.showTrails
  }

  const selectTrack = (icao24: string | null) => {
    state.selectedTrack = icao24
  }

  const toggleSimulator = () => {
    state.simulatorRunning = !state.simulatorRunning
  }

  const trackCount = computed(() => 0)

  return {
    state,
    setRange,
    toggleLabels,
    toggleVectors,
    toggleTrails,
    selectTrack,
    toggleSimulator,
    trackCount,
  }
}
