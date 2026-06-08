<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { ConflictAlert } from '@/composables/useWebSocket'

const props = defineProps<{
  rangeNm: number
  trackCount: number
  connected: boolean
  conflicts: ReadonlyArray<ConflictAlert>
}>()

const utcTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

const connStatus = computed(() => props.connected ? 'LIVE' : 'OFFLINE')

const conflictCount = computed(() => props.conflicts.length)
const alertCount = computed(() => props.conflicts.filter(c => c.severity === 'ALERT').length)
const warningCount = computed(() => props.conflicts.filter(c => c.severity === 'WARNING').length)
const hasConflicts = computed(() => conflictCount.value > 0)

onMounted(() => {
  const updateTime = () => {
    utcTime.value = new Date().toISOString().slice(11, 19) + 'Z'
  }
  updateTime()
  clockTimer = setInterval(updateTime, 1000)
})

onBeforeUnmount(() => {
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
})
</script>

<template>
  <div class="h-8 bg-[rgba(13,17,23,0.9)] border-b border-[rgba(0,255,65,0.15)] flex items-center px-4 select-none">
    <div class="flex items-center gap-2 flex-1">
      <span class="font-[Orbitron] text-sm font-bold text-[#00FF41] tracking-wider">ATC RADAR</span>
    </div>

    <div
      v-if="hasConflicts"
      class="flex items-center gap-2 mr-4 conflict-badge"
    >
      <span class="text-[11px] font-[JetBrains_Mono] font-bold text-[#FF2020]">
        ⚠ STCA
      </span>
      <span
        v-if="alertCount > 0"
        class="text-[10px] font-[JetBrains_Mono] font-bold bg-[rgba(255,32,32,0.3)] text-[#FF4040] px-1.5 py-0.5 rounded"
      >
        ALERT {{ alertCount }}
      </span>
      <span
        v-if="warningCount > 0"
        class="text-[10px] font-[JetBrains_Mono] font-bold bg-[rgba(255,160,32,0.2)] text-[#FFA020] px-1.5 py-0.5 rounded"
      >
        WARN {{ warningCount }}
      </span>
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

<style scoped>
.conflict-badge {
  animation: conflict-pulse 1s ease-in-out infinite;
}

@keyframes conflict-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
