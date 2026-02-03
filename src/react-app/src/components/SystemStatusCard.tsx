import type { ReactNode } from 'react'
import type { StatusResponse } from '@/network/api'

import { useEffect, useRef, useState } from 'react'
import { Card, CardBody } from '@heroui/card'
import {
  IconArrowsVertical,
  IconArrowsHorizontal,
  IconGauge,
  IconCpu,
  IconTemperature,
  IconDeviceSdCard,
  IconBolt,
  IconClock,
  IconClockHour3,
  IconDatabase,
  IconMapPin,
} from '@tabler/icons-react'

import { useRocam } from '@/network/rocamProvider'

const STATUS_ICON_PROPS = {
  size: 18,
  strokeWidth: 1.5,
  className: 'text-gray-500',
} as const

type StatusItem = {
  label: string
  value: string
  icon: ReactNode
  progress?: number
}

function formatDegrees(degrees: number) {
  return `${Math.round(degrees * 10) / 10}°`
}

function formatFps(fps: number) {
  return `${Math.round(fps * 10) / 10}`
}

function formatPercent(value: number) {
  return `${Math.round(value * 10) / 10}%`
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function calculateUsagePercent(used: number, total: number) {
  return total <= 0 ? 0 : (used / total) * 100
}

function formatTemperature(value: number) {
  return `${Math.round(value * 10) / 10}°C`
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${Math.round(value * 10) / 10}${units[unitIndex]}`
}

function formatStorageUsedTotal(used: number, total: number) {
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  return `${hours}h ${minutes}m`
}

function formatPower(value: number) {
  return `${Math.round(value * 10) / 10}W`
}

function formatLatLon(
  latitude: number | null,
  longitude: number | null
): string {
  if (latitude === null || longitude === null) {
    return 'N/A'
  }

  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function formatServerTime(timestampMs: number) {
  return new Date(timestampMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function buildStatusItems(status: StatusResponse): StatusItem[] {
  const recLeftMs = status.recording_duration_left_s * 1000

  return [
    {
      label: 'TILT',
      value: formatDegrees(status.tilt),
      icon: <IconArrowsVertical {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'PAN',
      value: formatDegrees(status.pan),
      icon: <IconArrowsHorizontal {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'REC LEFT',
      value: formatDuration(recLeftMs),
      icon: <IconClockHour3 {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'STORAGE',
      value: formatStorageUsedTotal(
        status.disk_used_bytes,
        status.disk_total_bytes
      ),
      progress: calculateUsagePercent(
        status.disk_used_bytes,
        status.disk_total_bytes
      ),
      icon: <IconDeviceSdCard {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'FPS',
      value: formatFps(status.average_fps),
      icon: <IconGauge {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'MEM',
      value: formatPercent(
        calculateUsagePercent(
          status.memory_used_bytes,
          status.memory_total_bytes
        )
      ),
      progress: calculateUsagePercent(
        status.memory_used_bytes,
        status.memory_total_bytes
      ),
      icon: <IconDatabase {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'CPU',
      value: formatPercent(status.cpu_utilization),
      progress: status.cpu_utilization,
      icon: <IconCpu {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'GPU',
      value: formatPercent(status.gpu_utilization),
      progress: clampPercent(status.gpu_utilization),
      icon: <IconCpu {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'TEMP',
      value: formatTemperature(status.core_temperature_celsius),
      icon: <IconTemperature {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'POWER',
      value: formatPower(status.system_power_w),
      icon: <IconBolt {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'SERVER TIME',
      value: formatServerTime(status.timestamp_ms),
      icon: <IconClock {...STATUS_ICON_PROPS} />,
    },
    {
      label: 'GPS LOCATION',
      value: formatLatLon(status.latitude, status.longitude),
      icon: <IconMapPin {...STATUS_ICON_PROPS} />,
    },
  ]
}

export function SystemStatusCard() {
  const { status } = useRocam()
  const [now, setNow] = useState(Date.now())
  const lastStatusChangeMsRef = useRef(0)

  useEffect(() => {
    if (status !== null) {
      lastStatusChangeMsRef.current = Date.now()
    }
  }, [status])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(id)
  }, [])

  if (status === null) {
    return (
      <Card>
        <CardBody className="px-6 py-5" />
      </Card>
    )
  }

  const statusItems = buildStatusItems(status)
  const baseMs =
    lastStatusChangeMsRef.current === 0
      ? Date.now()
      : lastStatusChangeMsRef.current
  const secondsAgo = Math.max(0, Math.floor((now - baseMs) / 1000))
  const lastUpdatedText = secondsAgo <= 60 ? `${secondsAgo}s` : '>60s'

  return (
    <Card radius="sm">
      <CardBody className="px-6 py-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-800 tracking-widest">
            SYSTEM STATUS
          </p>
          <p className="text-xs text-gray-500 font-medium tabular-nums">
            last updated: {lastUpdatedText} ago
          </p>
        </div>
        <div className="mt-2 gap-x-10 flex flex-wrap">
          {statusItems.map((item) => (
            <StatusItemRow key={item.label} item={item} />
          ))}
          <div className="grow basis-0 min-w-48" />
          <div className="grow basis-0 min-w-48" />
          <div className="grow basis-0 min-w-48" />
          <div className="grow basis-0 min-w-48" />
          <div className="grow basis-0 min-w-48" />
          <div className="grow basis-0 min-w-48" />
        </div>
      </CardBody>
    </Card>
  )
}

function StatusItemRow({ item }: { item: StatusItem }) {
  return (
    <div className="grow basis-0 my-4 min-w-48">
      <div className="flex items-center gap-2">
        {item.icon}
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">
          {item.label}
        </p>
      </div>
      <p
        className={
          'mt-2 text-lg font-medium text-gray-900 tabular-nums leading-none'
        }
      >
        {item.value}
      </p>
      {item.progress !== undefined && (
        <div className="relative mt-3 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gray-700 to-gray-400"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
