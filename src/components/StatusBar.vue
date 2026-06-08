<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  rangeNm: number
  trackCount: number
  connected: boolean
}>()

const utcTime = computed(() => {
  const now = new Date()
  return now.toISOString().slice(11, 19) + 'Z'
})

const connStatus = computed(() => props.connected ? 'LIVE' : 'OFFLINE')
</script>

<template>
  <div class="h-8 bg-[rgba(13,17,23,0.9)] border-b border-[rgba(0,255,65,0.15)] flex items-center px-4 select-none">
    <div class="flex items-center gap-2 flex-1">
      <span class="font-[Orbitron] text-sm font-bold text-[#00FF41] tracking-wider">ATC RADAR</span>
    </div>
    <div class="flex items-center gap-4">
      <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.7)]">{{ rangeNm }} NM</span>
      <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">|</span>
      <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.7)]">TRK: {{ trackCount }}</span>
      <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">|</span>
      <span class="text-[11px] font-[JetBrains_Mono] text-[#00FF41]">{{ utcTime }}</span>
      <span class="text-[11px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">|</span>
      <span
        :class="[
          'text-[11px] font-[JetBrains_Mono] font-bold',
          connected ? 'text-[#00FF41]' : 'text-red-400'
        ]"
      >
        {{ connStatus }}
      </span>
    </div>
  </div>
</template>
