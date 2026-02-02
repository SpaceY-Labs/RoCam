import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/button'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconHome,
} from '@tabler/icons-react'
import { useMeasure } from 'react-use'

import { useRocam } from '@/network/rocamProvider'
import DefaultLayout from '@/layouts/default'

export default function ControlPage() {
  const { apiClient, status, statusPollingError } = useRocam()
  const [streamContainerRef, streamBounds] = useMeasure<HTMLDivElement>()
  const [gridRef, gridBounds] = useMeasure<HTMLDivElement>()
  const { width, height } = streamBounds

  const ACTION_COOLDOWN_MS = 1500
  const [isArmLoading, setIsArmLoading] = useState(false)
  const [isRecordLoading, setIsRecordLoading] = useState(false)
  const [isArmCooldown, setIsArmCooldown] = useState(false)
  const [isRecordCooldown, setIsRecordCooldown] = useState(false)
  const armCooldownTimerRef = useRef<number | null>(null)
  const recordCooldownTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (statusPollingError) {
      console.error(statusPollingError)
    }
  }, [statusPollingError])

  useEffect(() => {
    return () => {
      if (armCooldownTimerRef.current !== null) {
        window.clearTimeout(armCooldownTimerRef.current)
      }
      if (recordCooldownTimerRef.current !== null) {
        window.clearTimeout(recordCooldownTimerRef.current)
      }
    }
  }, [])

  const bbox = status?.bbox
  const isArmed = status?.armed === true
  const statusLabel = status ? (isArmed ? 'Armed' : 'Disarmed') : 'Unknown'
  const statusDotClass = status
    ? isArmed
      ? 'bg-rose-400/90'
      : 'bg-emerald-400/90'
    : 'bg-slate-400'
  const statusTextClass = status
    ? isArmed
      ? 'text-rose-600'
      : 'text-emerald-600'
    : 'text-slate-400'
  const statusItems = [
    { label: 'TILT', value: formatDegrees(status?.tilt) },
    { label: 'PAN', value: formatDegrees(status?.pan) },
    { label: 'FPS', value: formatFps(status?.average_fps) },
    {
      label: 'MEM',
      value: formatPercent(calculateUsagePercent(status?.memory_usage_bytes)),
      progress: calculateUsagePercent(status?.memory_usage_bytes),
    },
    {
      label: 'CPU',
      value: formatPercent(status?.cpu_utilization),
      progress: clampPercent(status?.cpu_utilization),
    },
    {
      label: 'GPU',
      value: formatPercent(status?.gpu_utilization),
      progress: clampPercent(status?.gpu_utilization),
    },
    { label: 'TEMP', value: formatTemperature(status?.core_temperature_celsius) },
    {
      label: 'STORAGE',
      value: formatStorageLeft(status?.disk_usage_bytes),
      progress: calculateFreePercent(status?.disk_usage_bytes),
    },
    { label: 'POWER', value: formatPower(status?.system_power_w) },
    { label: 'REC LEFT', value: formatDuration(status?.recording_duration_left_ms) },
    {
      label: 'REC ID',
      value: formatRecordingId(status?.in_progress_recording_id),
      title: status?.in_progress_recording_id ?? undefined,
    },
  ]
  const glassPanelClass =
    'relative rounded-3xl border border-white/40 bg-gradient-to-b from-white/45 via-white/25 to-white/12 shadow-[0_20px_50px_rgba(15,23,42,0.14),0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-white/25 backdrop-blur-2xl backdrop-saturate-150'
  const glassOverlayClass =
    'pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-white/35 via-transparent to-white/8'
  const glassInsetClass =
    'pointer-events-none absolute inset-0 rounded-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.7),inset_0_-1px_0_rgba(15,23,42,0.08)]'

  const isRecording = Boolean(
    status?.is_recording ?? status?.in_progress_recording_id
  )

  const startCooldown = (
    setCooldown: (value: boolean) => void,
    timerRef: { current: number | null }
  ) => {
    setCooldown(true)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setCooldown(false)
      timerRef.current = null
    }, ACTION_COOLDOWN_MS)
  }

  const handleToggleArm = async () => {
    if (!apiClient || isArmLoading || isArmCooldown) return
    setIsArmLoading(true)
    startCooldown(setIsArmCooldown, armCooldownTimerRef)
    try {
      if (isArmed) {
        await apiClient.disarm()
      } else {
        await apiClient.arm()
      }
    } catch {
      console.error(`Failed to ${isArmed ? 'disarm' : 'arm'}`)
    } finally {
      setIsArmLoading(false)
    }
  }

  const handleToggleRecording = async () => {
    if (!apiClient || isRecordLoading || isRecordCooldown) return
    setIsRecordLoading(true)
    startCooldown(setIsRecordCooldown, recordCooldownTimerRef)
    try {
      if (isRecording) {
        await apiClient.stopRecording()
      } else {
        await apiClient.startRecording()
      }
    } catch {
      console.error(
        `Failed to ${isRecording ? 'stop' : 'start'} recording`
      )
    } finally {
      setIsRecordLoading(false)
    }
  }

  return (
    <DefaultLayout className="flex items-stretch">
      <div
        ref={gridRef}
        className="relative grid gap-4 m-4 mt-0 grid-cols-[auto_1fr] grid-rows-[1fr_auto] min-w-0 w-full"
      >
        {isRecording &&
          streamBounds.width > 0 &&
          gridBounds.width > 0 && (
            <div
              className="pointer-events-none absolute z-20 inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-600 shadow-[0_6px_16px_rgba(244,63,94,0.18)] backdrop-blur-md"
              style={{
                left: Math.max(0, streamBounds.left - gridBounds.left + 12),
                top: Math.max(0, streamBounds.top - gridBounds.top + 12),
              }}
            >
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              REC
            </div>
          )}
        <div
          ref={streamContainerRef}
          className="bg-gray-100 aspect-[9/16] rounded-lg flex items-center justify-center row-span-2"
        >
          <p>Live Stream Loading.....</p>
          {status?.preview && (
            <img
              alt="Camera Preview"
              className="absolute rotate-90 rounded-lg"
              src={`data:image/jpeg;base64,${status.preview}`}
              style={{ width: height, height: width }}
            />
          )}
          <div className="absolute" style={{ width, height }}>
            {bbox && (
              <>
                <div
                  className="absolute bg-green-500 text-white w-11 h-6 pl-1"
                  style={{
                    top: bbox.top * height - 24,
                    left: bbox.left * width,
                  }}
                >
                  {Math.round(bbox.conf * 100) / 100}
                </div>
                <div
                  className="absolute border-4 border-green-500"
                  style={{
                    top: bbox.top * height,
                    left: bbox.left * width,
                    width: bbox.width * width,
                    height: bbox.height * height,
                  }}
                />
              </>
            )}
          </div>
        </div>

        <div className={`${glassPanelClass} px-6 py-5`}>
          <div className={glassOverlayClass} />
          <div className={glassInsetClass} />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-600/80">
              <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
              System Status
            </div>
            <div className="flex items-center gap-3">
              {isRecording && (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-600 shadow-[0_6px_16px_rgba(244,63,94,0.18)] backdrop-blur-md">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  REC
                </div>
              )}
              <span
                className={`text-[10px] font-semibold uppercase tracking-[0.32em] ${statusTextClass}`}
              >
                {statusLabel}
              </span>
            </div>
          </div>
          <div className="relative mt-6 grid gap-y-6 gap-x-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {statusItems.map((item) => {
              const isUnavailable = item.value === 'N/A'
              const progress = item.progress ?? 0
              const hasProgress = item.progress !== undefined
              const progressBarClass =
                item.progress === null
                  ? 'bg-slate-400/40'
                  : 'bg-gradient-to-r from-slate-900/80 via-slate-700/70 to-slate-500/60'
              const valueTitle = item.title ?? item.value
              return (
                <div key={item.label} className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500/80">
                    {item.label}
                  </p>
                  <p
                    title={valueTitle}
                    className={
                      isUnavailable
                        ? 'mt-2 text-sm font-medium text-slate-500/70 tabular-nums'
                        : 'mt-2 text-[15px] font-semibold text-slate-950/90 tabular-nums'
                    }
                  >
                    {item.value}
                  </p>
                  {hasProgress && (
                    <div className="mt-3 h-1 w-full rounded-full bg-white/70">
                      <div
                        className={`h-1 rounded-full ${progressBarClass}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className={`${glassPanelClass} p-4`}>
          <div className={glassOverlayClass} />
          <div className={glassInsetClass} />
          <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-600/80">
              Controls
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-400">
              Manual
            </span>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button
              isDisabled={!apiClient || isArmLoading || isArmCooldown}
              radius="sm"
              variant="ghost"
              className={`border border-white/50 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${
                isArmed ? 'text-rose-600' : 'text-emerald-600'
              }`}
              onPress={handleToggleArm}
            >
              {isArmLoading
                ? isArmed
                  ? 'Disarming...'
                  : 'Arming...'
                : isArmed
                  ? 'Disarm'
                  : 'Arm'}
            </Button>
            <Button
              isDisabled={!apiClient || isRecordLoading || isRecordCooldown}
              radius="sm"
              variant="ghost"
              className={`border border-white/50 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording ? 'text-rose-600' : 'text-slate-800'
              }`}
              onPress={handleToggleRecording}
            >
              {isRecordLoading
                ? isRecording
                  ? 'Stopping...'
                  : 'Starting...'
                : isRecording
                  ? 'Stop Recording'
                  : 'Start Recording'}
            </Button>
          </div>

          <div className="grid gap-2 mt-5 grid-cols-3 grid-rows-3 w-fit">
            <div />
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="ghost"
              className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
              onPress={() => apiClient?.manualMove('up')}
            >
              <IconChevronUp />
            </Button>
            <div />
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="ghost"
              className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
              onPress={() => apiClient?.manualMove('left')}
            >
              <IconChevronLeft />
            </Button>
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="ghost"
              className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
              onPress={() => apiClient?.manualMoveTo(0, 0)}
            >
              <IconHome />
            </Button>
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="ghost"
              className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
              onPress={() => apiClient?.manualMove('right')}
            >
              <IconChevronRight />
            </Button>
            <div />
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="ghost"
              className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
              onPress={() => apiClient?.manualMove('down')}
            >
              <IconChevronDown />
            </Button>
            <div />
          </div>
          </div>
        </div>
      </div>
    </DefaultLayout>
  )
}

function formatDegrees(degrees: number | null | undefined) {
  if (degrees === null || degrees === undefined) return 'N/A'

  return `${Math.round(degrees * 10) / 10}°`
}

function formatFps(fps: number | null | undefined) {
  if (fps === null || fps === undefined) return 'N/A'

  return `${Math.round(fps * 10) / 10}`
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'N/A'

  return `${Math.round(value * 10) / 10}%`
}

function clampPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null

  return Math.max(0, Math.min(100, value))
}

function calculateUsagePercent(
  usage: { used: number; total: number } | null | undefined
) {
  if (!usage || usage.total <= 0) return null

  return (usage.used / usage.total) * 100
}

function calculateFreePercent(
  usage: { used: number; total: number } | null | undefined
) {
  if (!usage || usage.total <= 0) return null

  return ((usage.total - usage.used) / usage.total) * 100
}

function formatRecordingId(recordingId: string | null | undefined) {
  if (!recordingId) return 'N/A'

  if (recordingId.length <= 12) return recordingId

  return `${recordingId.slice(0, 8)}...${recordingId.slice(-4)}`
}

function formatTemperature(value: number | null | undefined) {
  if (value === null || value === undefined) return 'N/A'

  return `${Math.round(value * 10) / 10}°C`
}

function formatStorageLeft(
  diskUsage: { used: number; total: number } | null | undefined
) {
  if (!diskUsage) return 'N/A'

  const freeBytes = Math.max(0, diskUsage.total - diskUsage.used)
  return formatBytes(freeBytes)
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return 'N/A'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${Math.round(value * 10) / 10}${units[unitIndex]}`
}

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return 'N/A'

  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function formatPower(value: number | null | undefined) {
  if (value === null || value === undefined) return 'N/A'

  return `${Math.round(value * 10) / 10}W`
}
