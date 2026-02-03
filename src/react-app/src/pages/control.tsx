import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Spinner } from '@heroui/spinner'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconHome,
} from '@tabler/icons-react'
import { useMeasure } from 'react-use'

import { SystemStatusCard } from '@/components/SystemStatusCard'
import { useRocam } from '@/network/rocamProvider'
import DefaultLayout from '@/layouts/default'

export default function ControlPage() {
  const { apiClient, status, statusPollingError } = useRocam()
  const [streamContainerRef, streamBounds] = useMeasure<HTMLDivElement>()
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
  const isArmed = !!status?.armed
  const isRecording = !!status?.is_recording

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
      console.error(`Failed to ${isRecording ? 'stop' : 'start'} recording`)
    } finally {
      setIsRecordLoading(false)
    }
  }

  return (
    <DefaultLayout className="flex items-stretch">
      <div className="relative grid gap-4 m-4 mt-0 grid-cols-[auto_1fr] grid-rows-[1fr_auto] min-w-0 w-full">
        <Card radius="sm" ref={streamContainerRef} className="aspect-[9/16] row-span-2">
          <CardBody className="flex items-center justify-center">
            <Spinner label="Loading stream..." />
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

            {isRecording && (
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-semibold tracking-widest text-red-600 shadow-md shadow-red-500/20">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                REC
              </div>
            )}
            {isArmed && (
              <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-semibold tracking-widest text-amber-600 shadow-md shadow-amber-500/30">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                ARMED
              </div>
            )}
          </CardBody>
        </Card>

        <SystemStatusCard status={status} />

        <Card radius="sm">
          <CardBody className="px-6 p-4">
            <div className="relative">
              <div className="flex items-center justify-between pb-3 border-b border-white/30">
                <span className="text-[9px] font-semibold uppercase tracking-[0.35em] text-slate-600/70">
                  Controls
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.35em] text-slate-400">
                  Manual
                </span>
              </div>
              <div className="flex gap-3 flex-wrap mt-4">
                <Button
                  className={`border border-white/50 bg-white/55 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isArmed ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                  isDisabled={!apiClient || isArmLoading || isArmCooldown}
                  radius="full"
                  variant="ghost"
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
                  className={`border border-white/50 bg-white/55 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isRecording ? 'text-rose-600' : 'text-slate-800'
                  }`}
                  isDisabled={!apiClient || isRecordLoading || isRecordCooldown}
                  radius="full"
                  variant="ghost"
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
                  className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={status?.armed}
                  radius="sm"
                  size="lg"
                  variant="ghost"
                  onPress={() => apiClient?.manualMove('up')}
                >
                  <IconChevronUp />
                </Button>
                <div />
                <Button
                  isIconOnly
                  className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={status?.armed}
                  radius="sm"
                  size="lg"
                  variant="ghost"
                  onPress={() => apiClient?.manualMove('left')}
                >
                  <IconChevronLeft />
                </Button>
                <Button
                  isIconOnly
                  className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={status?.armed}
                  radius="sm"
                  size="lg"
                  variant="ghost"
                  onPress={() => apiClient?.manualMoveTo(0, 0)}
                >
                  <IconHome />
                </Button>
                <Button
                  isIconOnly
                  className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={status?.armed}
                  radius="sm"
                  size="lg"
                  variant="ghost"
                  onPress={() => apiClient?.manualMove('right')}
                >
                  <IconChevronRight />
                </Button>
                <div />
                <Button
                  isIconOnly
                  className="border border-white/50 bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={status?.armed}
                  radius="sm"
                  size="lg"
                  variant="ghost"
                  onPress={() => apiClient?.manualMove('down')}
                >
                  <IconChevronDown />
                </Button>
                <div />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </DefaultLayout>
  )
}
