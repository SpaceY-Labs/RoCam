import { Card, CardBody } from '@heroui/card'
import { Trans, useLingui } from '@lingui/react/macro'

import { useRocam } from '@/network/rocamProvider'

export function LogsCard() {
  const { t } = useLingui()
  const { logs } = useRocam()

  return (
    <Card radius="sm">
      <CardBody className="px-6 py-5">
        <p className="text-xs font-semibold uppercase text-gray-800 tracking-widest">
          <Trans>Logs</Trans>
        </p>
        <div className="mt-3 h-40 rounded-md border border-gray-200 bg-gray-50 p-3 overflow-y-auto">
          {logs.length > 0 ? (
            logs.map((entry) => (
              <div
                key={entry.id}
                className="font-mono text-xs leading-5 text-gray-700 break-all"
              >
                [{formatTime(entry.timestamp)}] {entry.level} {entry.logger}:{' '}
                {entry.message}
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-500">{t`Waiting for logs...`}</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
