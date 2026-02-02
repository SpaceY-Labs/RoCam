import { useEffect, useState } from 'react'
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
  const [streamContainerRef, { width, height }] = useMeasure<HTMLDivElement>()

  // added: simple UI state for start/stop buttons
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  useEffect(() => {
    if (statusPollingError) {
      console.error(statusPollingError)
    }
  }, [statusPollingError])

  const bbox = status?.bbox
  const isArmed = status?.armed === true
  const statusLabel = status ? (isArmed ? 'Armed' : 'Disarmed') : 'Unknown'
  const statusDotClass = status
    ? isArmed
      ? 'bg-rose-500'
      : 'bg-emerald-400'
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
    { label: 'STORAGE', value: formatStorageLeft(status?.disk_usage_bytes) },
    { label: 'POWER', value: formatPower(status?.system_power_w) },
    { label: 'REC LEFT', value: formatDuration(status?.recording_duration_left_ms) },
  ]

  const handleStartRecording = async () => {
    if (!apiClient || isStarting) return
    setIsStarting(true)
    try {
      await apiClient.startRecording()
    } catch {
      console.error('Failed to start recording')
    } finally {
      setIsStarting(false)
    }
  }

  const handleStopRecording = async () => {
    if (!apiClient || isStopping) return
    setIsStopping(true)
    try {
      await apiClient.stopRecording()
    } catch {
      console.error('Failed to stop recording')
    } finally {
      setIsStopping(false)
    }
  }

  return (
    <DefaultLayout className="flex items-stretch">
      <div className="grid gap-4 m-4 mt-0 grid-cols-[auto_1fr] grid-rows-[1fr_auto] min-w-0 w-full">
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

        <div className="rounded-2xl border border-slate-200/60 bg-white/70 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
              <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
              System Status
            </div>
            <span
              className={`text-[10px] font-semibold uppercase tracking-[0.3em] ${statusTextClass}`}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-4 grid gap-y-4 gap-x-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {statusItems.map((item) => {
              const isUnavailable = item.value === 'N/A'
              const progress = item.progress ?? 0
              const hasProgress = item.progress !== undefined
              const progressBarClass =
                item.progress === null ? 'bg-slate-200' : 'bg-slate-900/70'
              return (
                <div key={item.label} className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                    {item.label}
                  </p>
                  <p
                    className={
                      isUnavailable
                        ? 'mt-1 text-sm font-medium text-slate-400 tabular-nums'
                        : 'mt-1 text-sm font-semibold text-slate-900 tabular-nums'
                    }
                  >
                    {item.value}
                  </p>
                  {hasProgress && (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className={`h-1.5 rounded-full ${progressBarClass}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-gray-100 rounded-lg p-4">
          <div className="flex gap-4 flex-wrap">
            <Button
              color="danger"
              radius="sm"
              variant="bordered"
              onPress={() => apiClient?.arm()}
            >
              Arm
            </Button>
            <Button
              color="primary"
              radius="sm"
              variant="bordered"
              onPress={() => apiClient?.disarm()}
            >
              Disarm
            </Button>

            {/* added: recording buttons */}
            <Button
              isDisabled={!apiClient || isStarting}
              radius="sm"
              variant="solid"
              onPress={handleStartRecording}
            >
              {isStarting ? 'Starting...' : 'Start Recording'}
            </Button>
            <Button
              color="danger"
              isDisabled={!apiClient || isStopping}
              radius="sm"
              variant="bordered"
              onPress={handleStopRecording}
            >
              {isStopping ? 'Stopping...' : 'Stop Recording'}
            </Button>
          </div>

          <div className="grid gap-2 mt-4 grid-cols-3 grid-rows-3 w-fit">
            <div />
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="flat"
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
              variant="flat"
              onPress={() => apiClient?.manualMove('left')}
            >
              <IconChevronLeft />
            </Button>
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="flat"
              onPress={() => apiClient?.manualMoveTo(0, 0)}
            >
              <IconHome />
            </Button>
            <Button
              isIconOnly
              disabled={status?.armed}
              radius="sm"
              size="lg"
              variant="flat"
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
              variant="flat"
              onPress={() => apiClient?.manualMove('down')}
            >
              <IconChevronDown />
            </Button>
            <div />
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
