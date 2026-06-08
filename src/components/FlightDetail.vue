<script setup lang="ts">
import type { RadarTrack } from '@/composables/useWebSocket'

defineProps<{
  track: RadarTrack | null
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <Transition name="detail">
    <div
      v-if="track"
      class="absolute z-50 top-12 left-12 w-64 bg-[rgba(13,17,23,0.92)] backdrop-blur-md border border-[rgba(0,212,255,0.3)] rounded-lg shadow-[0_0_20px_rgba(0,212,255,0.15)] overflow-hidden"
    >
      <div class="flex items-center justify-between px-3 py-2 border-b border-[rgba(0,212,255,0.15)]">
        <span class="font-[Orbitron] text-base font-bold text-[#00D4FF] tracking-wider">{{ track.callsign }}</span>
        <button
          @click="emit('close')"
          class="w-6 h-6 flex items-center justify-center text-[rgba(0,212,255,0.6)] hover:text-[#00D4FF] transition-colors text-sm"
        >
          ✕
        </button>
      </div>
      <div class="px-3 py-2 space-y-1.5">
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">ICAO24</span>
          <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(200,220,200,0.9)]">{{ track.icao24 }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">ALT</span>
          <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(200,220,200,0.9)]">FL{{ Math.round(track.altitude / 100) }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">GS</span>
          <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(200,220,200,0.9)]">{{ Math.round(track.groundSpeed) }} kt</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">TRK</span>
          <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(200,220,200,0.9)]">{{ Math.round(track.track) }}°</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">V/S</span>
          <span
            :class="[
              'text-[11px] font-[JetBrains_Mono]',
              track.verticalRate > 100 ? 'text-[#00FF41]' : track.verticalRate < -100 ? 'text-[#FF6B35]' : 'text-[rgba(200,220,200,0.9)]'
            ]"
          >
            {{ track.verticalRate > 0 ? '+' : '' }}{{ Math.round(track.verticalRate) }} ft/m
          </span>
        </div>
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">LAT</span>
          <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(200,220,200,0.9)]">{{ track.lat.toFixed(4) }}°</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[10px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">LON</span>
          <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(200,220,200,0.9)]">{{ track.lon.toFixed(4) }}°</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.detail-enter-active,
.detail-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.detail-enter-from,
.detail-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}
</style>
