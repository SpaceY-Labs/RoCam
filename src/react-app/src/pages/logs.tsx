import { useEffect, useRef } from 'react'
import { Card, CardBody } from '@heroui/card'
import { Spinner } from '@heroui/spinner'
import { useLingui } from '@lingui/react/macro'

import DefaultLayout from '@/layouts/default'
import { useRocam } from '@/network/rocamProvider'

function levelColor(level: string): string {
  switch (level) {
    case 'DEBUG':
      return 'text-gray-500'
    case 'INFO':
      return 'text-foreground'
    case 'WARNING':
      return 'text-amber-600'
    case 'ERROR':
    case 'CRITICAL':
      return 'text-red-600'
    default:
      return 'text-foreground'
  }
}

export default function LogsPage() {
  const { t } = useLingui()
  const { logs, logsError } = useRocam()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <DefaultLayout className="flex flex-col">
      <div className="flex flex-col gap-4 m-4 mt-0 min-w-0 w-full flex-1">
        <Card radius="sm" className="flex-1 min-h-0 flex flex-col">
          <CardBody className="flex-1 overflow-hidden flex flex-col p-0">
            {logsError && (
              <div className="px-4 py-2 bg-danger-100 text-danger-700 text-sm">
                {logsError.message}
              </div>
            )}
            <div className="flex-1 overflow-auto p-4 font-mono text-sm">
              {logs.length === 0 && !logsError && (
                <div className="flex items-center justify-center h-full text-default-500">
                  <Spinner size="lg" label={t`Connecting to logs stream...`} />
                </div>
              )}
              {logs.map((entry, i) => (
                <div
                  key={`${entry.created}-${i}`}
                  className={`py-0.5 break-all ${levelColor(entry.level)}`}
                >
                  {entry.message}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </CardBody>
        </Card>
      </div>
    </DefaultLayout>
  )
}
