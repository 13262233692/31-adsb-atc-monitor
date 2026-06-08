<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useRadarStore } from '@/composables/useRadarStore'
import RadarCanvas from '@/components/RadarCanvas.vue'
import ControlPanel from '@/components/ControlPanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import FlightDetail from '@/components/FlightDetail.vue'

const { tracks, connected, connect, disconnect } = useWebSocket()
const { state, selectTrack } = useRadarStore()

const selectedTrackData = computed(() => {
  if (!state.selectedTrack) return null
  return tracks.value.get(state.selectedTrack) ?? null
})

const trackCount = computed(() => tracks.value.size)

function handleSelectTrack(icao24: string | null) {
  selectTrack(icao24)
}

function handleCloseDetail() {
  selectTrack(null)
}

onMounted(() => {
  connect()
})

onUnmounted(() => {
  disconnect()
})
</script>

<template>
  <div class="w-screen h-screen flex flex-col overflow-hidden bg-[#0A0E14]">
    <StatusBar
      :rangeNm="state.rangeNm"
      :trackCount="trackCount"
      :connected="connected"
    />
    <div class="flex flex-1 min-h-0">
      <div class="flex-1 relative">
        <RadarCanvas
          :tracks="tracks"
          :rangeNm="state.rangeNm"
          :centerLat="state.centerLat"
          :centerLon="state.centerLon"
          :showLabels="state.showLabels"
          :showVectors="state.showVectors"
          :showTrails="state.showTrails"
          :selectedTrack="state.selectedTrack"
          @select-track="handleSelectTrack"
        />
        <FlightDetail
          :track="selectedTrackData"
          @close="handleCloseDetail"
        />
      </div>
      <ControlPanel :connected="connected" />
    </div>
  </div>
</template>
