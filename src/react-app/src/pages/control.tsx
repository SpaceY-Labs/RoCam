import { useCallback, useEffect, useRef } from 'react'
import { Card, CardBody } from '@heroui/card'
import { Spinner } from '@heroui/spinner'
import { useMeasure } from 'react-use'
import { Trans, useLingui } from '@lingui/react/macro'
import { useAtomValue } from 'jotai'

import { ControlsCard } from '@/components/ControlsCard'
import { LogsCard } from '@/components/LogsCard'
import { SystemStatusCard } from '@/components/SystemStatusCard'
import { useRocam } from '@/network/rocamProvider'
import {
  invertDragAtom,
  dragSensitivityAtom,
  showLogsAtom,
} from '@/store/settingsAtom'
import { Navbar } from '@/components/navbar'

/** Minimum milliseconds between consecutive manualMoveTo API calls. */
const DRAG_THROTTLE_MS = 50

export default function ControlPage() {
  const { t } = useLingui()
  const { apiClient, status } = useRocam()
  const [streamContainerRef, streamBounds] = useMeasure<HTMLDivElement>()
  const { width, height } = streamBounds
  const showDeveloperLogs = useAtomValue(showLogsAtom)

  const bbox = status?.bbox
  const isArmed = !!status?.armed
  const isRecording = !!status?.is_recording

  // ── Drag-to-control ──────────────────────────────────────────────────
  const invertDrag = useAtomValue(invertDragAtom)
  const dragSensitivity = useAtomValue(dragSensitivityAtom)

  // Keep fresh values in refs so callbacks never go stale.
  const statusRef = useRef(status)

  statusRef.current = status
  const apiClientRef = useRef(apiClient)

  apiClientRef.current = apiClient
  const invertDragRef = useRef(invertDrag)

  invertDragRef.current = invertDrag
  const dragSensitivityRef = useRef(dragSensitivity)

  dragSensitivityRef.current = dragSensitivity

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

    const sensitivity = dragSensitivityRef.current
    const sign = invertDragRef.current ? -1 : 1
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const newPan = drag.startPan + dx * sensitivity * sign
    const newTilt = drag.startTilt - dy * sensitivity * sign

    drag.lastCallTime = now
    client.manualMoveTo(newTilt, newPan)
  }, [])

  const handlePointerUp = useCallback(() => {
    dragRef.current.isDragging = false
  }, [])

  // ── Scroll-to-zoom (focal length) ────────────────────────────────────
  const wheelLastCallRef = useRef(0)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const s = statusRef.current
    const client = apiClientRef.current

    if (
      !s ||
      s.armed ||
      !client ||
      s.focal_length_mm == null ||
      s.focal_length_min_mm == null ||
      s.focal_length_max_mm == null
    )
      return

    const now = Date.now()

    if (now - wheelLastCallRef.current < DRAG_THROTTLE_MS) return
    wheelLastCallRef.current = now

    const range = s.focal_length_max_mm - s.focal_length_min_mm
    const step = Math.max(1, range * 0.05)
    const delta = e.deltaY < 0 ? step : -step
    const newFocal = Math.max(
      s.focal_length_min_mm,
      Math.min(s.focal_length_max_mm, s.focal_length_mm + delta)
    )

    client.setFocalLength(newFocal)
  }, [])

  useEffect(() => {
    const el = overlayRef.current

    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })

    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  return (
    <div className="relative flex flex-col items-stretch h-screen">
      <Navbar />
      <div
        className={`flex-1 min-h-0 grid gap-4 p-4 pt-0 grid-cols-[auto_1fr] min-w-0 w-full ${showDeveloperLogs ? 'grid-rows-[1fr_1fr_auto]' : 'grid-rows-[1fr_auto]'}`}
      >
        <Card
          ref={streamContainerRef}
          className={`aspect-[9/16] ${showDeveloperLogs ? 'row-span-3' : 'row-span-2'}`}
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

            {/* Transparent overlay that captures drag gestures and scroll-to-zoom */}
            <div
              ref={overlayRef}
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

        {showDeveloperLogs && <LogsCard />}

        <ControlsCard />
      </div>
    </div>
  )
}
