<script setup lang="ts">
import { computed } from 'vue'
import { useRadarStore } from '@/composables/useRadarStore'

const { state, setRange, toggleLabels, toggleVectors, toggleTrails, toggleSimulator } = useRadarStore()

defineProps<{
  connected: boolean
}>()

const ranges: (10 | 20 | 40 | 80)[] = [10, 20, 40, 80]

const utcTime = computed(() => {
  const now = new Date()
  return now.toUTCString().slice(-12, -4)
})

const simulatorIcon = computed(() => state.simulatorRunning ? '⏹' : '▶')
</script>

<template>
  <div class="w-20 bg-[#0D1117] border-l border-[rgba(0,255,65,0.15)] flex flex-col items-center py-3 gap-3 select-none">
    <div class="text-[9px] font-[Orbitron] text-[rgba(0,255,65,0.5)] uppercase tracking-widest">Range</div>
    <div class="flex flex-col gap-1">
      <button
        v-for="r in ranges"
        :key="r"
        @click="setRange(r)"
        :class="[
          'w-14 h-7 text-xs font-[JetBrains_Mono] rounded border transition-all',
          state.rangeNm === r
            ? 'bg-[rgba(0,255,65,0.15)] border-[#00FF41] text-[#00FF41]'
            : 'bg-transparent border-[rgba(0,255,65,0.2)] text-[rgba(0,255,65,0.5)] hover:border-[rgba(0,255,65,0.4)]'
        ]"
      >
        {{ r }}
      </button>
    </div>

    <div class="w-12 h-px bg-[rgba(0,255,65,0.15)]"></div>

    <div class="text-[9px] font-[Orbitron] text-[rgba(0,255,65,0.5)] uppercase tracking-widest">Filter</div>
    <div class="flex flex-col gap-1.5">
      <button
        @click="toggleLabels"
        :class="[
          'w-14 h-7 text-[10px] font-[JetBrains_Mono] rounded border transition-all',
          state.showLabels
            ? 'bg-[rgba(0,255,65,0.15)] border-[#00FF41] text-[#00FF41]'
            : 'bg-transparent border-[rgba(0,255,65,0.2)] text-[rgba(0,255,65,0.35)]'
        ]"
      >
        LBL
      </button>
      <button
        @click="toggleVectors"
        :class="[
          'w-14 h-7 text-[10px] font-[JetBrains_Mono] rounded border transition-all',
          state.showVectors
            ? 'bg-[rgba(0,255,65,0.15)] border-[#00FF41] text-[#00FF41]'
            : 'bg-transparent border-[rgba(0,255,65,0.2)] text-[rgba(0,255,65,0.35)]'
        ]"
      >
        VEC
      </button>
      <button
        @click="toggleTrails"
        :class="[
          'w-14 h-7 text-[10px] font-[JetBrains_Mono] rounded border transition-all',
          state.showTrails
            ? 'bg-[rgba(0,255,65,0.15)] border-[#00FF41] text-[#00FF41]'
            : 'bg-transparent border-[rgba(0,255,65,0.2)] text-[rgba(0,255,65,0.35)]'
        ]"
      >
        TRK
      </button>
    </div>

    <div class="w-12 h-px bg-[rgba(0,255,65,0.15)]"></div>

    <button
      @click="toggleSimulator"
      :class="[
        'w-14 h-8 text-sm rounded border transition-all',
        state.simulatorRunning
          ? 'bg-[rgba(255,107,53,0.15)] border-[#FF6B35] text-[#FF6B35]'
          : 'bg-[rgba(0,255,65,0.1)] border-[rgba(0,255,65,0.3)] text-[rgba(0,255,65,0.6)]'
      ]"
    >
      {{ simulatorIcon }}
    </button>

    <div class="w-12 h-px bg-[rgba(0,255,65,0.15)]"></div>

    <div class="flex items-center gap-1.5">
      <div
        :class="[
          'w-2 h-2 rounded-full',
          connected ? 'bg-[#00FF41] shadow-[0_0_6px_#00FF41]' : 'bg-red-500 shadow-[0_0_6px_red]'
        ]"
      ></div>
      <span class="text-[8px] font-[JetBrains_Mono] text-[rgba(0,255,65,0.5)]">UDP</span>
    </div>

    <div class="mt-auto">
      <div class="text-[8px] font-[Orbitron] text-[rgba(0,255,65,0.4)] text-center">UTC</div>
      <div class="text-[10px] font-[JetBrains_Mono] text-[#00FF41] text-center">{{ utcTime }}</div>
    </div>
  </div>
</template>
