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
import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'

import { useRocam } from '@/network/rocamProvider'
import DefaultLayout from '@/layouts/default'

export default function ControlPage() {
  const { i18n } = useLingui()
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
          <p><Trans>Live Stream Loading.....</Trans></p>
          {status?.preview && (
            <img
              alt={i18n._(msg`Camera Preview`)}
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

        <div className="bg-gray-100 rounded-lg p-4 font-mono">
          <p>
            <span className="font-medium text-gray-500"><Trans>Status:</Trans> </span>
            {status?.armed ? (
              <span className="text-red-500"><Trans>Armed</Trans></span>
            ) : (
              <span><Trans>Disarmed</Trans></span>
            )}
          </p>
          <div className="flex gap-4 font-mono mt-4">
            <div>
              <p className="text-sm font-medium text-gray-500 font-mono">
                <Trans>TILT</Trans>
              </p>
              <p className="w-16">{formatDegrees(status?.tilt)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 font-mono"><Trans>PAN</Trans></p>
              <p className="w-16">{formatDegrees(status?.pan)}</p>
            </div>
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
              <Trans>Arm</Trans>
            </Button>
            <Button
              color="primary"
              radius="sm"
              variant="bordered"
              onPress={() => apiClient?.disarm()}
            >
              <Trans>Disarm</Trans>
            </Button>

            {/* added: recording buttons */}
            <Button
              isDisabled={!apiClient || isStarting}
              radius="sm"
              variant="solid"
              onPress={handleStartRecording}
            >
              {isStarting ? <Trans>Starting...</Trans> : <Trans>Start Recording</Trans>}
            </Button>
            <Button
              color="danger"
              isDisabled={!apiClient || isStopping}
              radius="sm"
              variant="bordered"
              onPress={handleStopRecording}
            >
              {isStopping ? <Trans>Stopping...</Trans> : <Trans>Stop Recording</Trans>}
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
