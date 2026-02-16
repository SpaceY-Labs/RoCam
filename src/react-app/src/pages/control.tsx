import { useCallback, useEffect, useRef } from 'react'
import { Card, CardBody } from '@heroui/card'
import { Spinner } from '@heroui/spinner'
import { addToast } from '@heroui/toast'
import { useMeasure } from 'react-use'
import { Trans, useLingui } from '@lingui/react/macro'

import { ControlsCard } from '@/components/ControlsCard'
import { SystemStatusCard } from '@/components/SystemStatusCard'
import { useRocam } from '@/network/rocamProvider'
import DefaultLayout from '@/layouts/default'

/** Degrees of gimbal movement per pixel of pointer drag. */
const DRAG_SENSITIVITY = 0.15
/** Minimum milliseconds between consecutive manualMoveTo API calls. */
const DRAG_THROTTLE_MS = 50

export default function ControlPage() {
  const { t } = useLingui()
  const { apiClient, status, statusPollingError } = useRocam()
  const [streamContainerRef, streamBounds] = useMeasure<HTMLDivElement>()
  const { width, height } = streamBounds
  const lastErrorMessageRef = useRef<string | null>(null)

  useEffect(() => {
    if (statusPollingError) {
      // eslint-disable-next-line no-console
      console.error(statusPollingError)
      const message = getErrorMessage(statusPollingError)

      if (lastErrorMessageRef.current !== message) {
        addToast({
          title: t`Connection error`,
          description: message,
          color: 'danger',
        })
        lastErrorMessageRef.current = message
      }
    } else {
      lastErrorMessageRef.current = null
    }
  }, [statusPollingError, t])

  const bbox = status?.bbox
  const isArmed = !!status?.armed
  const isRecording = !!status?.is_recording

  // ── Drag-to-control ──────────────────────────────────────────────────
  // Keep fresh values in refs so callbacks never go stale.
  const statusRef = useRef(status)

  statusRef.current = status
  const apiClientRef = useRef(apiClient)

  apiClientRef.current = apiClient

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startTilt: 0,
    startPan: 0,
    lastCallTime: 0,
  })

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const s = statusRef.current

    if (!s || s.armed) return
    const drag = dragRef.current

    drag.isDragging = true
    drag.startX = e.clientX
    drag.startY = e.clientY
    drag.startTilt = s.tilt
    drag.startPan = s.pan
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current

    if (!drag.isDragging) return
    const client = apiClientRef.current

    if (!client) return

    const now = Date.now()

    if (now - drag.lastCallTime < DRAG_THROTTLE_MS) return

    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const newPan = drag.startPan + dx * DRAG_SENSITIVITY
    const newTilt = drag.startTilt - dy * DRAG_SENSITIVITY

    drag.lastCallTime = now
    client.manualMoveTo(newTilt, newPan)
  }, [])

  const handlePointerUp = useCallback(() => {
    dragRef.current.isDragging = false
  }, [])

  return (
    <DefaultLayout className="flex items-stretch">
      <div className="relative grid gap-4 m-4 mt-0 grid-cols-[auto_1fr] grid-rows-[1fr_auto] min-w-0 w-full">
        <Card
          ref={streamContainerRef}
          className="aspect-[9/16] row-span-2"
          radius="sm"
        >
          <CardBody className="relative flex items-center justify-center overflow-hidden">
            {status?.preview ? (
              <img
                alt={t`Camera Preview`}
                className="absolute rotate-90 rounded-lg max-w-none object-cover"
                src={`data:image/jpeg;base64,${status.preview}`}
                style={{ width: height + 1, height: width + 1 }}
              />
            ) : (
              <Spinner label={t`Loading stream...`} />
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
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-semibold tracking-widest text-red-600 shadow-md shadow-red-500/20 bg-white">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <Trans>REC</Trans>
              </div>
            )}
            {isArmed && (
              <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-semibold tracking-widest text-amber-600 shadow-md shadow-amber-500/30 bg-white">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                <Trans>ARMED</Trans>
              </div>
            )}

            {/* Transparent overlay that captures drag gestures for gimbal control */}
            <div
              className={`absolute inset-0 z-10 ${isArmed ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ touchAction: 'none' }}
              onPointerCancel={handlePointerUp}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
          </CardBody>
        </Card>

        <SystemStatusCard />

        <ControlsCard />
      </div>
    </DefaultLayout>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message

  return String(error ?? 'Unknown error')
}
