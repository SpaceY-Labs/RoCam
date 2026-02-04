import { useEffect } from 'react'
import { Card, CardBody } from '@heroui/card'
import { Spinner } from '@heroui/spinner'
import { useMeasure } from 'react-use'
import { Trans, useLingui } from '@lingui/react/macro'

import { ControlsCard } from '@/components/ControlsCard'
import { SystemStatusCard } from '@/components/SystemStatusCard'
import { useRocam } from '@/network/rocamProvider'
import DefaultLayout from '@/layouts/default'

export default function ControlPage() {
  const { t } = useLingui()
  const { status, statusPollingError } = useRocam()
  const [streamContainerRef, streamBounds] = useMeasure<HTMLDivElement>()
  const { width, height } = streamBounds

  useEffect(() => {
    if (statusPollingError) {
      // eslint-disable-next-line no-console
      console.error(statusPollingError)
    }
  }, [statusPollingError])

  const bbox = status?.bbox
  const isArmed = !!status?.armed
  const isRecording = !!status?.is_recording

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
          </CardBody>
        </Card>

        <SystemStatusCard />

        <ControlsCard />
      </div>
    </DefaultLayout>
  )
}
